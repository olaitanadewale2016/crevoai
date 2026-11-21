'use client';

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
    mounted: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'app-theme';

function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
    }
    return 'system';
}

function applyTheme(resolvedTheme: ResolvedTheme) {
    if (typeof document === 'undefined') return;
    if (resolvedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

interface ThemeProviderProps {
    children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [mounted, setMounted] = useState(false);
    const [theme, setThemeState] = useState<Theme>('system');
    const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('light');

    // On client mount, sync with localStorage and system preference
    useEffect(() => {
        setMounted(true);
        const stored = getStoredTheme();
        setThemeState(stored);
        setSystemTheme(getSystemTheme());
    }, []);

    // Derive resolved theme from theme choice and system preference
    // Before mount, maintain server-deterministic default ('light') to prevent hydration mismatch
    const resolvedTheme = useMemo<ResolvedTheme>(
        () => {
            if (!mounted) return 'light';
            return theme === 'system' ? systemTheme : theme;
        },
        [mounted, theme, systemTheme]
    );

    // Apply theme to DOM when resolved theme changes (after mount)
    useEffect(() => {
        if (mounted) {
            applyTheme(resolvedTheme);
        }
    }, [resolvedTheme, mounted]);

    // Listen for system theme changes
    useEffect(() => {
        if (!mounted) return;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            setSystemTheme(e.matches ? 'dark' : 'light');
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [mounted]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, newTheme);
        }
    };

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, mounted }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextType {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
