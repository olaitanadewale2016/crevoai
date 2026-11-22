'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Compass,
  Laptop,
  MousePointerClick,
  Palette,
  History,
  Code2,
  CheckCircle2,
} from 'lucide-react';

export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const STORAGE_KEY = 'crevo_has_seen_builder_tutorial';

export function AppTutorial({
  isOpen,
  onClose,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const steps: TourStep[] = [
    {
      id: 'chat-input',
      targetSelector: '[data-tour="chat-input"]',
      title: t('AI Website Builder & Prompts'),
      description: t(
        'Describe the website, app, or tool you want to build. You can request new sections, design changes, and even @mention specific elements to guide the AI.'
      ),
      icon: Sparkles,
      position: 'top',
    },
    {
      id: 'device-switcher',
      targetSelector: '[data-tour="device-switcher"]',
      title: t('Responsive Device Preview'),
      description: t(
        'Preview your website in real-time as the AI builds. Switch effortlessly between Desktop (100%), Tablet (768px), and Mobile (390px) viewports with realistic device framing.'
      ),
      icon: Laptop,
      position: 'bottom',
    },
    {
      id: 'inspect-toggle',
      targetSelector: '[data-tour="inspect-toggle"]',
      title: t('Point-and-Click Inspector'),
      description: t(
        'Switch to Inspect mode to click any element inside your website. Edit text inline, fine-tune Tailwind CSS classes, delete elements, or ask AI to improve the styling.'
      ),
      icon: MousePointerClick,
      position: 'bottom',
    },
    {
      id: 'design-toggle',
      targetSelector: '[data-tour="design-toggle"]',
      title: t('Instant Theme Designer'),
      description: t(
        'Click Design to explore color themes and typography presets. Changes cascade automatically across every page without modifying core CSS.'
      ),
      icon: Palette,
      position: 'bottom',
    },
    {
      id: 'history-button',
      targetSelector: '[data-tour="history-button"]',
      title: t('Checkpoints & Revision History'),
      description: t(
        'Every AI build and style update automatically creates a checkpoint. Undo, redo, or restore past versions of your project with zero hassle.'
      ),
      icon: History,
      position: 'bottom',
    },
    {
      id: 'preview-tabs',
      targetSelector: '[data-tour="preview-tabs"]',
      title: t('Full Screen & Source Code'),
      description: t(
        'Collapse the chat for a full-screen preview experience, or switch to the Code tab to inspect and copy the clean React & TypeScript source code.'
      ),
      icon: Code2,
      position: 'bottom',
    },
  ];

  const updateTargetPosition = useCallback(() => {
    if (!isOpen) return;
    const step = steps[currentStep];
    if (!step) return;

    const el = document.querySelector(step.targetSelector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [isOpen, currentStep]);

  useEffect(() => {
    if (!isOpen) return;
    updateTargetPosition();
    window.addEventListener('resize', updateTargetPosition);
    window.addEventListener('scroll', updateTargetPosition, true);
    return () => {
      window.removeEventListener('resize', updateTargetPosition);
      window.removeEventListener('scroll', updateTargetPosition, true);
    };
  }, [isOpen, updateTargetPosition]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        handleDismiss();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStep]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {}
    onClose();
  };

  const handleComplete = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {}
    onComplete?.();
    onClose();
  };

  if (!isOpen) return null;

  const step = steps[currentStep];
  const StepIcon = step?.icon || Compass;
  const isLast = currentStep === steps.length - 1;

  // Calculate popover positioning relative to target element or center of screen
  let popoverStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 99999,
  };

  if (targetRect) {
    const margin = 14;
    const popoverWidth = 380;
    const popoverHeight = 220;

    let top = targetRect.bottom + margin;
    let left = targetRect.left + (targetRect.width / 2) - (popoverWidth / 2);

    // If too close to bottom, show on top of element
    if (top + popoverHeight > window.innerHeight - 20) {
      top = Math.max(20, targetRect.top - popoverHeight - margin);
    }
    // Prevent clipping off sides
    left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left));

    popoverStyle = {
      ...popoverStyle,
      top: `${top}px`,
      left: `${left}px`,
      width: `${popoverWidth}px`,
    };
  } else {
    // Center of screen fallback
    popoverStyle = {
      ...popoverStyle,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '380px',
    };
  }

  return (
    <>
      {/* Dark semi-transparent backdrop */}
      <div
        className="fixed inset-0 z-[99990] bg-black/45 backdrop-blur-[2px] transition-opacity duration-200"
        onClick={handleDismiss}
      />

      {/* Target element highlight cut-out spotlight */}
      {targetRect && (
        <div
          className="fixed z-[99995] pointer-events-none rounded-xl ring-4 ring-primary ring-offset-2 ring-offset-background transition-all duration-300 ease-in-out shadow-[0_0_25px_rgba(var(--primary-rgb,59,130,246),0.4)]"
          style={{
            top: `${Math.max(0, targetRect.top - 4)}px`,
            left: `${Math.max(0, targetRect.left - 4)}px`,
            width: `${targetRect.width + 8}px`,
            height: `${targetRect.height + 8}px`,
          }}
        />
      )}

      {/* Tour popover card */}
      <div
        style={popoverStyle}
        className="bg-card text-card-foreground border border-border/80 rounded-2xl shadow-2xl p-5 animate-in fade-in-0 zoom-in-95 duration-200 ring-1 ring-black/10 flex flex-col gap-3.5"
      >
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <StepIcon className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              {t('Tutorial')} · {t('Step')} {currentStep + 1} {t('of')} {steps.length}
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
            title={t('Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div>
          <h4 className="font-semibold text-base text-foreground mb-1.5 leading-snug">
            {step.title}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Footer with progress dots and buttons */}
        <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-1">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === currentStep
                    ? 'w-5 bg-primary'
                    : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            {currentStep > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrev}
                className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5 me-0.5" />
                {t('Back')}
              </Button>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={handleNext}
              className="h-7 px-3 text-xs flex items-center gap-1 font-medium shadow-xs"
            >
              <span>{isLast ? t('Got it!') : t('Next')}</span>
              {isLast ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default AppTutorial;
