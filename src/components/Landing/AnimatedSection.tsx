'use client';

import { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import { cn } from '@/lib/utils';

interface AnimatedSectionProps {
    children: React.ReactNode;
    className?: string;
    delay?: number;
}

export function AnimatedSection({ children, className, delay = 0 }: AnimatedSectionProps) {
    const [mounted, setMounted] = useState(false);
    const { ref, inView } = useInView({
        threshold: 0.05,
        triggerOnce: true,
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // Ensure section is visible on SSR / initial render and when in view
    const isVisible = !mounted || inView;

    return (
        <section
            ref={ref}
            className={cn(
                'transition-all duration-700 ease-out',
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8',
                className
            )}
            style={{ transitionDelay: `${delay}ms` }}
        >
            {children}
        </section>
    );
}
