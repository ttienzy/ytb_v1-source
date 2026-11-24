import React from 'react'
import { Film, Crosshair, Sparkles, Layers, Clapperboard } from 'lucide-react'
import type { WorkflowTabId, WorkflowTabItem } from '../types'
import { DEFAULT_WORKFLOW_TABS } from '../types'

interface WorkflowTabsProps {
  tabs?: WorkflowTabItem[]
  activeTab: WorkflowTabId
  onTabChange: (tabId: WorkflowTabId) => void
  className?: string
}

export function WorkflowTabs({
  tabs = DEFAULT_WORKFLOW_TABS,
  activeTab,
  onTabChange,
  className = '',
}: WorkflowTabsProps) {
  const renderIcon = (iconName: WorkflowTabItem['iconName'], isActive: boolean, tabId: WorkflowTabId) => {
    const size = 14
    let color = isActive ? '#4f46e5' : '#64748b'
    if (isActive) {
      if (tabId === 'motion') color = '#0284c7'
      else if (tabId === 'muse') color = '#7c3aed'
      else color = '#4f46e5'
    }

    switch (iconName) {
      case 'film':
        return <Film size={size} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
      case 'crosshair':
        return <Crosshair size={size} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
      case 'layers':
        return <Layers size={size} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
      case 'clapperboard':
        return <Clapperboard size={size} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
      case 'sparkles':
      default:
        return <Sparkles size={size} color={color} strokeWidth={isActive ? 2.2 : 1.8} />
    }
  }

  return (
    <nav
      className={`wf-tabs-container ${className}`}
      role="tablist"
      aria-label="Chế độ làm việc Canvas AI"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const isNew = tab.badge === 'Mới' || tab.badgeType === 'new'
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`wf-tab-item ${isActive ? 'active' : ''} wf-tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            title={tab.description}
          >
            <span className="wf-tab-icon-wrap">{renderIcon(tab.iconName, isActive, tab.id)}</span>
            <span className="wf-tab-title">{tab.title}</span>

            {tab.badge && (
              <span
                className={`wf-tab-badge ${isNew ? 'wf-badge-new' : `wf-badge-${tab.badgeType || 'count'}`}`}
                aria-label={tab.badge}
              >
                {isNew && <span className="wf-badge-sparkle-dot" />}
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
