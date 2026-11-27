'use client';

import * as React from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/contexts/LanguageContext"

interface TableActionMenuProps {
  children: React.ReactNode
}

interface TableActionMenuTriggerProps {
  className?: string
  children?: React.ReactNode
}

interface TableActionMenuContentProps {
  children: React.ReactNode
  className?: string
  align?: "start" | "end"
}

interface TableActionMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode
  variant?: "default" | "destructive"
}

interface TableActionMenuLabelProps {
  children: React.ReactNode
  className?: string
}

interface TableActionMenuSeparatorProps {
  className?: string
}

const VIEWPORT_PADDING = 8
const MENU_GAP = 4

const TableActionMenuContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>
} | null>(null)

function useTableActionMenu() {
  const context = React.useContext(TableActionMenuContext)
  if (!context) {
    throw new Error("TableActionMenu components must be used within a TableActionMenu")
  }
  return context
}

// Custom event for closing all menus
const CLOSE_ALL_MENUS_EVENT = 'tableActionMenuCloseAll'

function TableActionMenu({ children }: TableActionMenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const menuId = React.useId()

  // Listen for close-all event from other menus
  React.useEffect(() => {
    const handleCloseAll = (e: CustomEvent<{ exceptId: string }>) => {
      if (e.detail.exceptId !== menuId) {
        setOpen(false)
      }
    }

    document.addEventListener(CLOSE_ALL_MENUS_EVENT, handleCloseAll as EventListener)
    return () => {
      document.removeEventListener(CLOSE_ALL_MENUS_EVENT, handleCloseAll as EventListener)
    }
  }, [menuId])

  // Close on click outside, escape, and outer page scroll
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!target.closest('[data-table-action-menu-content]') && !target.closest('[data-table-action-menu-trigger]')) {
        setOpen(false)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (target && typeof target.closest === 'function' && target.closest('[data-table-action-menu-content]')) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  // Wrap setOpen to dispatch close-all event when opening
  const handleSetOpen = React.useCallback((newOpen: boolean) => {
    if (newOpen) {
      document.dispatchEvent(new CustomEvent(CLOSE_ALL_MENUS_EVENT, {
        detail: { exceptId: menuId }
      }))
    }
    setOpen(newOpen)
  }, [menuId])

  return (
    <TableActionMenuContext.Provider value={{ open, setOpen: handleSetOpen, triggerRef }}>
      <div className="relative" data-table-action-menu>
        {children}
      </div>
    </TableActionMenuContext.Provider>
  )
}

function TableActionMenuTrigger({ className, children }: TableActionMenuTriggerProps) {
  const { t } = useTranslation()
  const { open, setOpen, triggerRef } = useTableActionMenu()

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    triggerRef.current = e.currentTarget
    setOpen(!open)
  }

  return (
    <Button
      ref={triggerRef}
      type="button"
      variant="ghost"
      className={cn("h-8 w-8 p-0", className)}
      onClick={handleClick}
      aria-expanded={open}
      aria-haspopup="menu"
      data-table-action-menu-trigger
    >
      {children ?? (
        <>
          <span className="sr-only">{t('Open menu')}</span>
          <MoreHorizontal className="h-4 w-4" />
        </>
      )}
    </Button>
  )
}

function computeMenuCoordinates(params: {
  triggerRect: DOMRect
  menuWidth: number
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
  viewportOffsetTop: number
  viewportOffsetLeft: number
  align: "start" | "end"
  isRtl: boolean
}) {
  const {
    triggerRect,
    menuWidth,
    menuHeight,
    viewportWidth,
    viewportHeight,
    viewportOffsetTop,
    viewportOffsetLeft,
    align,
    isRtl,
  } = params

  const minTop = viewportOffsetTop + VIEWPORT_PADDING
  const maxBottom = viewportOffsetTop + viewportHeight - VIEWPORT_PADDING
  const spaceBelow = Math.max(0, maxBottom - (triggerRect.bottom + MENU_GAP))
  const spaceAbove = Math.max(0, (triggerRect.top - MENU_GAP) - minTop)

  const shouldFlipUp = menuHeight > spaceBelow && spaceAbove > spaceBelow
  const availableVertical = shouldFlipUp ? spaceAbove : spaceBelow
  const maxHeight = Math.max(104, Math.floor(availableVertical))
  const renderedHeight = Math.min(menuHeight, maxHeight)

  let top = shouldFlipUp
    ? triggerRect.top - MENU_GAP - renderedHeight
    : triggerRect.bottom + MENU_GAP

  top = Math.min(maxBottom - renderedHeight, Math.max(minTop, top))

  // In RTL, "start" is right-aligned and "end" is left-aligned
  const alignRightEdge = isRtl ? align === "start" : align === "end"
  const rawLeft = alignRightEdge ? triggerRect.right - menuWidth : triggerRect.left
  const minLeft = viewportOffsetLeft + VIEWPORT_PADDING
  const maxLeft = Math.max(minLeft, viewportOffsetLeft + viewportWidth - menuWidth - VIEWPORT_PADDING)
  const left = Math.min(maxLeft, Math.max(minLeft, rawLeft))

  return {
    top: Math.round(top),
    left: Math.round(left),
    maxHeight,
    placement: shouldFlipUp ? ("top" as const) : ("bottom" as const),
  }
}

function TableActionMenuContent({ children, className, align = "end" }: TableActionMenuContentProps) {
  const { isRtl } = useTranslation()
  const { open, triggerRef } = useTableActionMenu()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = React.useState<{
    top: number
    left: number
    maxHeight: number
    placement: "top" | "bottom"
  } | null>(null)

  const updatePosition = React.useCallback(() => {
    const triggerEl = triggerRef.current
    const menuEl = contentRef.current
    if (!triggerEl || !menuEl) return

    const triggerRect = triggerEl.getBoundingClientRect()
    const menuRect = menuEl.getBoundingClientRect()
    const vv = window.visualViewport
    const viewportWidth = vv?.width ?? window.innerWidth
    const viewportHeight = vv?.height ?? window.innerHeight
    const viewportOffsetTop = vv?.offsetTop ?? 0
    const viewportOffsetLeft = vv?.offsetLeft ?? 0

    // Use scrollHeight in case previous maxHeight constrained menuRect.height
    const naturalHeight = Math.max(menuEl.scrollHeight, menuRect.height)
    const naturalWidth = Math.max(menuEl.scrollWidth, menuRect.width)

    setCoords(
      computeMenuCoordinates({
        triggerRect,
        menuWidth: naturalWidth,
        menuHeight: naturalHeight,
        viewportWidth,
        viewportHeight,
        viewportOffsetTop,
        viewportOffsetLeft,
        align,
        isRtl,
      })
    )
  }, [triggerRef, align, isRtl])

  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    updatePosition()

    const vv = window.visualViewport
    window.addEventListener('resize', updatePosition)
    vv?.addEventListener('resize', updatePosition)
    vv?.addEventListener('scroll', updatePosition)

    return () => {
      window.removeEventListener('resize', updatePosition)
      vv?.removeEventListener('resize', updatePosition)
      vv?.removeEventListener('scroll', updatePosition)
    }
  }, [open, updatePosition])

  if (!open) return null

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      data-table-action-menu-content
      data-side={coords?.placement ?? "bottom"}
      className={cn(
        "fixed z-50 min-w-[8rem] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        coords ? "animate-in fade-in-0 zoom-in-95" : "pointer-events-none",
        className
      )}
      style={{
        top: coords ? coords.top : -9999,
        left: coords ? coords.left : -9999,
        maxHeight: coords ? coords.maxHeight : undefined,
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body
  )
}

function TableActionMenuItem({
  children,
  className,
  variant = "default",
  onClick,
  ...props
}: TableActionMenuItemProps) {
  const { setOpen } = useTableActionMenu()

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    setOpen(false)
  }

  return (
    <button
      role="menuitem"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm whitespace-nowrap outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        variant === "destructive" && "text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  )
}

function TableActionMenuLabel({ children, className }: TableActionMenuLabelProps) {
  return (
    <div className={cn("px-2 py-1.5 text-sm font-medium", className)}>
      {children}
    </div>
  )
}

function TableActionMenuSeparator({ className }: TableActionMenuSeparatorProps) {
  return (
    <div className={cn("bg-border -mx-1 my-1 h-px", className)} role="separator" />
  )
}

export {
  TableActionMenu,
  TableActionMenuTrigger,
  TableActionMenuContent,
  TableActionMenuItem,
  TableActionMenuLabel,
  TableActionMenuSeparator,
  computeMenuCoordinates,
}
