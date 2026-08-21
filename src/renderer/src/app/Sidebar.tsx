import { useState } from 'react'
import type { Category, NibIndex } from '@shared/types'
import type { NibOps } from '../lib/useNib'
import { categoryInScope, smartCounts } from '../lib/selection'
import type { ScopeFilter, Selection } from '../lib/selection'
import { subCount } from '../lib/notes'

interface SidebarProps {
  index: NibIndex
  selection: Selection
  onSelect: (selection: Selection) => void
  scope: ScopeFilter
  onScope: (scope: ScopeFilter) => void
  ops: NibOps
  onDeleteCategory: (category: Category) => void
}

/**
 * The 210px sidebar: smart rows, the scope filter, then the categories with
 * their sub-categories under them.
 */
export function Sidebar({
  index,
  selection,
  onSelect,
  scope,
  onScope,
  ops,
  onDeleteCategory
}: SidebarProps): React.JSX.Element {
  const counts = smartCounts(index, scope)
  const categories = index.categories.filter((category) => categoryInScope(category, scope))

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
          sticky
          active={selection.kind === 'sticky'}
          onClick={() => onSelect({ kind: 'sticky' })}
        />
      </div>

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

      <div className="category-list">
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            selection={selection}
            onSelect={onSelect}
            ops={ops}
            onDelete={() => onDeleteCategory(category)}
          />
        ))}

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
  sticky = false,
  onClick
}: {
  label: string
  count: number
  active: boolean
  sticky?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className={`row smart-row${active ? ' is-active' : ''}`} onClick={onClick}>
      {/* The sticky row's marker is a rounded square rather than a dot, which is
          what tells the three smart rows apart at a glance. */}
      <span className={sticky ? 'marker marker-sticky' : 'marker'} />
      <span className="row-label">{label}</span>
      <span className="row-count">{count}</span>
    </button>
  )
}

function CategoryRow({
  category,
  selection,
  onSelect,
  ops,
  onDelete
}: {
  category: Category
  selection: Selection
  onSelect: (selection: Selection) => void
  ops: NibOps
  onDelete: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const active = selection.kind === 'category' && selection.categoryId === category.id

  return (
    <div className="category-block">
      <div
        className={`row category-row${active ? ' is-active' : ''}`}
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
        <button type="button" className="row-action danger" title="Delete category" onClick={onDelete}>
          ×
        </button>
        <span className="row-count">{category.notes.length}</span>
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
            />
          ))}
          <InlineInput
            placeholder="+ Sub-category…"
            className="add-row add-sub"
            onCommit={(name) => ops.addSub(category.id, name)}
          />
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
  ops
}: {
  categoryId: string
  subId: string
  name: string
  count: number
  active: boolean
  onSelect: (selection: Selection) => void
  ops: NibOps
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)

  return (
    <div
      className={`row sub-row${active ? ' is-active' : ''}`}
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
        onClick={() => ops.deleteSub(categoryId, subId)}
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
