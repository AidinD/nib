import { useState } from 'react'
import type { Category, NibIndex } from '@shared/types'
import type { NibOps } from '../lib/useNib'
import { categoryInScope, liveNotes, smartCounts } from '../lib/selection'
import type { ScopeFilter, Selection } from '../lib/selection'
import { subCount } from '../lib/notes'
import type { DropSlot } from '../lib/dnd'
import { DRAG_MIME, draggedItem, endDrag, readDrop, slotEquals, slotFor, startDrag } from '../lib/dnd'

interface SidebarProps {
  index: NibIndex
  selection: Selection
  onSelect: (selection: Selection) => void
  scope: ScopeFilter
  onScope: (scope: ScopeFilter) => void
  ops: NibOps
  onDeleteCategory: (category: Category) => void
  onDeleteSub: (categoryId: string, subId: string, name: string) => void
  onDeleteTag: (tagId: string, name: string) => void
}

/** Which row a dragged note is currently hovering over. */
type NoteTarget = { categoryId: string; subId: string | null } | null

/**
 * The 210px sidebar: smart rows, the scope filter, then the categories with
 * their sub-categories under them.
 *
 * It is also the drop zone that gives sub-categories their point: a note dropped
 * on a sub-category row moves into it, and one dropped on a category row moves
 * out to that category's loose notes.
 */
export function Sidebar({
  index,
  selection,
  onSelect,
  scope,
  onScope,
  ops,
  onDeleteCategory,
  onDeleteSub,
  onDeleteTag
}: SidebarProps): React.JSX.Element {
  const counts = smartCounts(index, scope)
  const categories = index.categories.filter((category) => categoryInScope(category, scope))
  /**
   * Tags that are actually on something, with how many notes each is on.
   *
   * A tag nobody has used is not listed. It still exists, still shows in the
   * picker, and appears here the moment it is put on a note - which keeps this
   * a list of what your notebook contains rather than a list of what you once
   * typed.
   */
  const tagRows = index.tags
    .map((tag) => ({
      tag,
      count: index.categories
        .filter((category) => categoryInScope(category, scope))
        .reduce(
          (total, category) =>
            total + category.notes.filter((note) => !note.archived && note.tags.includes(tag.id)).length,
          0
        )
    }))
    .filter((row) => row.count > 0)

  const [categorySlot, setCategorySlot] = useState<DropSlot>(null)
  const [noteTarget, setNoteTarget] = useState<NoteTarget>(null)

  const clearTargets = (): void => {
    setCategorySlot(null)
    setNoteTarget(null)
  }

  return (
    <nav className="sidebar">
      <div className="smart-rows">
        <SmartRow
          label="All notes"
          count={counts.all}
          active={selection.kind === 'all'}
          onClick={() => onSelect({ kind: 'all' })}
        />
        <SmartRow
          label="Recent"
          count={counts.recent}
          active={selection.kind === 'recent'}
          onClick={() => onSelect({ kind: 'recent' })}
        />
        <SmartRow
          label="Sticky notes"
          count={counts.sticky}
          marker="sticky"
          active={selection.kind === 'sticky'}
          onClick={() => onSelect({ kind: 'sticky' })}
        />
        {/* Only when there is something to need you. An always-present row
            reading 0 is furniture; this one appears when it means something. */}
        {counts.alerts > 0 && (
          <SmartRow
            label="Needs you"
            count={counts.alerts}
            marker="alert"
            active={selection.kind === 'alerts'}
            onClick={() => onSelect({ kind: 'alerts' })}
          />
        )}
        {/* Same rule: the archive is a place you go looking for something, so
            the row appears once there is something in it and stays out of the
            way otherwise. */}
        {counts.archived > 0 && (
          <SmartRow
            label="Archive"
            count={counts.archived}
            marker="archive"
            active={selection.kind === 'archive'}
            onClick={() => onSelect({ kind: 'archive' })}
          />
        )}
      </div>

      {/*
        Tags, listed only once at least one note carries one.
        
        Same rule the Archive and Needs-you rows follow: a section reading zero
        is furniture. It sits below the smart rows and above the categories
        because that is what it is - a way of cutting across the filing rather
        than a part of it.
      */}
      {tagRows.length > 0 && (
        <div className="tag-rows">
          <div className="tag-rows-head">Tags</div>
          {tagRows.map(({ tag, count }) => (
            <div key={tag.id} className="tag-row-holder">
              <button
                type="button"
                className={`row smart-row${
                  selection.kind === 'tag' && selection.tagId === tag.id ? ' is-active' : ''
                }`}
                onClick={() => onSelect({ kind: 'tag', tagId: tag.id })}
              >
                <span className="marker" style={{ background: tag.color }} />
                <span className="row-label">{tag.name}</span>
                <span className="row-count">{count}</span>
              </button>
              <button
                type="button"
                className="row-action danger tag-row-delete"
                title={`Delete the tag "${tag.name}". Notes keep it and get it back if you re-create it.`}
                onClick={() => onDeleteTag(tag.id, tag.name)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="scope-filter" role="group" aria-label="Scope">
        {(
          [
            ['all', 'All'],
            ['W', 'Work'],
            ['P', 'Private']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`scope-option${scope === value ? ' is-active' : ''}`}
            onClick={() => onScope(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="category-list"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearTargets()
          }
        }}
      >
        {categories.map((category, position) => (
          <CategoryRow
            key={category.id}
            category={category}
            nextCategoryId={categories[position + 1]?.id ?? null}
            selection={selection}
            onSelect={onSelect}
            ops={ops}
            onDelete={() => onDeleteCategory(category)}
            onDeleteSub={onDeleteSub}
            categorySlot={categorySlot}
            setCategorySlot={setCategorySlot}
            noteTarget={noteTarget}
            setNoteTarget={setNoteTarget}
            clearTargets={clearTargets}
          />
        ))}

        {categorySlot !== null && categorySlot.before === null && <div className="drop-marker" />}

        <InlineInput
          placeholder="+ Category…"
          onCommit={(name) => ops.addCategory(name)}
          className="add-row add-category"
        />
      </div>
    </nav>
  )
}

function SmartRow({
  label,
  count,
  active,
  marker = 'plain',
  onClick
}: {
  label: string
  count: number
  active: boolean
  marker?: 'plain' | 'sticky' | 'alert' | 'archive'
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`row smart-row${active ? ' is-active' : ''}`} onClick={onClick}>
      {/* The markers are what tell the smart rows apart at a glance: a dot for
          the plain ones, a rounded amber square for sticky, an orange ring for
          the action points. */}
      <span className={marker === 'plain' ? 'marker' : `marker marker-${marker}`} />
      <span className="row-label">{label}</span>
      <span className="row-count">{count}</span>
    </button>
  )
}

function CategoryRow({
  category,
  nextCategoryId,
  selection,
  onSelect,
  ops,
  onDelete,
  onDeleteSub,
  categorySlot,
  setCategorySlot,
  noteTarget,
  setNoteTarget,
  clearTargets
}: {
  category: Category
  nextCategoryId: string | null
  selection: Selection
  onSelect: (selection: Selection) => void
  ops: NibOps
  onDelete: () => void
  onDeleteSub: (categoryId: string, subId: string, name: string) => void
  categorySlot: DropSlot
  setCategorySlot: (slot: DropSlot) => void
  noteTarget: NoteTarget
  setNoteTarget: (target: NoteTarget) => void
  clearTargets: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  // The sub-category field is opened by the row's +, not left standing under
  // every category: a field per category, always visible, was most of the
  // sidebar's height and none of its content.
  const [addingSub, setAddingSub] = useState(false)
  const active = selection.kind === 'category' && selection.categoryId === category.id
  const isNoteTarget = noteTarget?.categoryId === category.id && noteTarget.subId === null

  /**
   * One row, two kinds of drag: another category being reordered against it, or
   * a note being moved into its loose notes. `types` is all `dragover` will say
   * about the payload, so the kind comes from the module-level drag state.
   */
  const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) {
      return
    }
    const item = draggedItem()
    if (item === null) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (item.kind === 'category') {
      setNoteTarget(null)
      const next = slotFor(event, event.currentTarget, category.id, nextCategoryId)
      if (!slotEquals(next, categorySlot)) {
        setCategorySlot(next)
      }
      return
    }
    setCategorySlot(null)
    if (!isNoteTarget) {
      setNoteTarget({ categoryId: category.id, subId: null })
    }
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const payload = readDrop(event)
    const slot = categorySlot
    clearTargets()
    if (payload === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (payload.kind === 'category') {
      if (slot !== null) {
        ops.moveCategoryBefore(payload.categoryId, slot.before)
      }
      return
    }
    ops.moveNote(payload.noteId, category.id, null)
  }

  return (
    <div className="category-block">
      {categorySlot !== null && categorySlot.before === category.id && <div className="drop-marker" />}
      <div
        className={`row category-row${active ? ' is-active' : ''}${
          isNoteTarget ? ' is-drop-target' : ''
        }`}
        draggable={!renaming}
        onDragStart={(event) => startDrag(event, { kind: 'category', categoryId: category.id })}
        onDragEnd={() => {
          endDrag()
          clearTargets()
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDoubleClick={() => setRenaming(true)}
      >
        <button
          type="button"
          className={`caret${category.open ? ' is-open' : ''}`}
          aria-label={category.open ? 'Collapse' : 'Expand'}
          onClick={() => ops.setCategoryOpen(category.id, !category.open)}
        />
        <span className="dot" style={{ background: category.color }} />

        {renaming ? (
          <InlineInput
            className="rename-input"
            initial={category.name}
            placeholder="Category name"
            onCommit={(name) => {
              if (name.length > 0) {
                ops.renameCategory(category.id, name)
              }
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
            keepOpen={false}
          />
        ) : (
          <button
            type="button"
            className="row-label"
            onClick={() => onSelect({ kind: 'category', categoryId: category.id })}
          >
            {category.name}
          </button>
        )}

        {/* A category that already carries a scope keeps its chip visible at
            partial opacity, so the classification stays readable without hover. */}
        <button
          type="button"
          className={`scope-chip${category.scope !== '' ? ' is-set' : ''}`}
          title="Cycle scope: none → Work → Private"
          onClick={() => ops.cycleCategoryScope(category.id)}
        >
          {category.scope === '' ? '–' : category.scope}
        </button>
        <button
          type="button"
          className="row-action"
          title="Add a sub-category"
          onClick={() => {
            // Opening the field on a collapsed category would type into
            // something nobody can see.
            ops.setCategoryOpen(category.id, true)
            setAddingSub(true)
          }}
        >
          +
        </button>
        <button type="button" className="row-action danger" title="Delete category" onClick={onDelete}>
          ×
        </button>
        <span className="row-count">{liveNotes(category).length}</span>
      </div>

      {category.open && (
        <div className="sub-list">
          {category.subs.map((sub) => (
            <SubRow
              key={sub.id}
              categoryId={category.id}
              subId={sub.id}
              name={sub.name}
              count={subCount(category, sub.id)}
              active={
                selection.kind === 'sub' &&
                selection.categoryId === category.id &&
                selection.subId === sub.id
              }
              onSelect={onSelect}
              ops={ops}
              onDeleteSub={onDeleteSub}
              isDropTarget={noteTarget?.categoryId === category.id && noteTarget.subId === sub.id}
              setNoteTarget={setNoteTarget}
              clearTargets={clearTargets}
            />
          ))}
          {addingSub && (
            <InlineInput
              placeholder="Sub-category name"
              className="add-row add-sub"
              keepOpen={false}
              onCommit={(name) => {
                if (name.length > 0) {
                  ops.addSub(category.id, name)
                }
                setAddingSub(false)
              }}
              onCancel={() => setAddingSub(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function SubRow({
  categoryId,
  subId,
  name,
  count,
  active,
  onSelect,
  ops,
  onDeleteSub,
  isDropTarget,
  setNoteTarget,
  clearTargets
}: {
  categoryId: string
  subId: string
  name: string
  count: number
  active: boolean
  onSelect: (selection: Selection) => void
  ops: NibOps
  onDeleteSub: (categoryId: string, subId: string, name: string) => void
  isDropTarget: boolean
  setNoteTarget: (target: NoteTarget) => void
  clearTargets: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      className={`row sub-row${active ? ' is-active' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME) || draggedItem()?.kind !== 'note') {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!isDropTarget) {
          setNoteTarget({ categoryId, subId })
        }
      }}
      onDrop={(event) => {
        const payload = readDrop(event)
        clearTargets()
        if (payload === null || payload.kind !== 'note') {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        ops.moveNote(payload.noteId, categoryId, subId)
      }}
      onDoubleClick={() => setRenaming(true)}
    >
      {renaming ? (
        <InlineInput
          className="rename-input"
          initial={name}
          placeholder="Sub-category name"
          onCommit={(next) => {
            if (next.length > 0) {
              ops.renameSub(categoryId, subId, next)
            }
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
          keepOpen={false}
        />
      ) : (
        <button
          type="button"
          className="row-label"
          onClick={() => onSelect({ kind: 'sub', categoryId, subId })}
        >
          {name}
        </button>
      )}
      <button
        type="button"
        className="row-action danger"
        title="Delete sub-category"
        onClick={() => onDeleteSub(categoryId, subId, name)}
      >
        ×
      </button>
      <span className="row-count">{count}</span>
    </div>
  )
}

/**
 * The dashed add fields and the inline rename share one input: both commit on
 * Enter and cancel on Escape. `keepOpen` is what separates them - an add field
 * stays and clears itself, a rename closes.
 */
function InlineInput({
  placeholder,
  onCommit,
  onCancel,
  initial = '',
  className = '',
  keepOpen = true
}: {
  placeholder: string
  onCommit: (value: string) => void
  onCancel?: () => void
  initial?: string
  className?: string
  keepOpen?: boolean
}): React.JSX.Element {
  const [value, setValue] = useState(initial)

  return (
    <input
      className={className}
      placeholder={placeholder}
      value={value}
      autoFocus={!keepOpen}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (!keepOpen) {
          onCancel?.()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          const trimmed = value.trim()
          if (trimmed.length > 0 || !keepOpen) {
            onCommit(trimmed)
          }
          if (keepOpen) {
            setValue('')
          }
        } else if (event.key === 'Escape') {
          setValue(initial)
          onCancel?.()
        }
      }}
    />
  )
}
