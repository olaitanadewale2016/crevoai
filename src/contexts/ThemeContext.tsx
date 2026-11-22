'use client';

import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';

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

function isValidTheme(val: unknown): val is Theme {
    return val === 'light' || val === 'dark' || val === 'system';
}

function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme | null {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    return isValidTheme(stored) ? stored : null;
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
    defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
    const initialDefault = isValidTheme(defaultTheme) ? defaultTheme : 'system';
    const [mounted, setMounted] = useState(false);
    const [adminDefaultTheme, setAdminDefaultTheme] = useState<Theme>(initialDefault);
    const [theme, setThemeState] = useState<Theme>(initialDefault);
    const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('light');

    // Keep adminDefaultTheme aligned with SSR prop updates
    useEffect(() => {
        if (!isValidTheme(defaultTheme)) return;
        setAdminDefaultTheme(defaultTheme);
        if (!getStoredTheme()) {
            setThemeState(defaultTheme);
        }
    }, [defaultTheme]);

    // On client mount, sync with personal localStorage override or admin defaultTheme
    useEffect(() => {
        setMounted(true);
        const stored = getStoredTheme();
        setThemeState(stored ?? adminDefaultTheme);
        setSystemTheme(getSystemTheme());
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Listen for appSettingsUpdated and explicit admin default theme changes
    useEffect(() => {
        const handleSettingsUpdated = (e: Event) => {
            const detail = (e as CustomEvent<{ default_theme?: unknown }>).detail;
            if (isValidTheme(detail?.default_theme)) {
                setAdminDefaultTheme(detail.default_theme);
                if (!getStoredTheme()) {
                    setThemeState(detail.default_theme);
                }
            }
        };

        const handleAdminDefaultChanged = (e: Event) => {
            const nextTheme = (e as CustomEvent<unknown>).detail;
            if (isValidTheme(nextTheme)) {
                try {
                    localStorage.removeItem(STORAGE_KEY);
                } catch {}
                setAdminDefaultTheme(nextTheme);
                setThemeState(nextTheme);
            }
        };

        window.addEventListener('appSettingsUpdated', handleSettingsUpdated);
        window.addEventListener('appDefaultThemeChanged', handleAdminDefaultChanged);
        return () => {
            window.removeEventListener('appSettingsUpdated', handleSettingsUpdated);
            window.removeEventListener('appDefaultThemeChanged', handleAdminDefaultChanged);
        };
    }, []);

    // Derive resolved theme from theme choice and system preference
    const resolvedTheme = useMemo<ResolvedTheme>(() => {
        if (!mounted) {
            return initialDefault === 'dark' ? 'dark' : 'light';
        }
        return theme === 'system' ? systemTheme : theme;
    }, [mounted, theme, systemTheme, initialDefault]);

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

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(STORAGE_KEY, newTheme);
            } catch {}
        }
    }, []);

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
