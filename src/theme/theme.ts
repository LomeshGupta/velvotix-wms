import { createTheme } from "@mui/material/styles";

/**
 * Dock-floor palette: ink and concrete with steel as the working colour. Signal amber is reserved
 * for "something is happening right now" (the active scan field, in-progress work); it is never
 * used as decoration.
 */
const ink = "#14202B";
const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

declare module "@mui/material/styles" {
  interface Palette { signal: Palette["primary"]; ink: string }
  interface PaletteOptions { signal?: PaletteOptions["primary"]; ink?: string }
}

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "data" },
  defaultColorScheme: "light",
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#3B5B7A", dark: "#2B4560", contrastText: "#FFFFFF" },
        secondary: { main: "#F2A900", contrastText: ink },
        signal: { main: "#F2A900", contrastText: ink },
        ink,
        success: { main: "#1E7F4F" },
        error: { main: "#B83227" },
        warning: { main: "#8A5A00" },
        info: { main: "#3B5B7A" },
        background: { default: "#EEF0F2", paper: "#FFFFFF" },
        text: { primary: ink, secondary: "#4A5967" },
        divider: "#CBD2D9",
      },
    },
    dark: {
      palette: {
        primary: { main: "#8FB2D4", dark: "#6E93B7", contrastText: "#0E151B" },
        secondary: { main: "#F2B73A", contrastText: "#0E151B" },
        signal: { main: "#F2B73A", contrastText: "#0E151B" },
        ink: "#0A1016",
        success: { main: "#4CC38A" },
        error: { main: "#F07A6E" },
        warning: { main: "#E0A64A" },
        info: { main: "#8FB2D4" },
        background: { default: "#0E151B", paper: "#16202A" },
        text: { primary: "#E6EDF3", secondary: "#9AA9B7" },
        divider: "#2A3744",
      },
    },
  },
  shape: { borderRadius: 3 },
  typography: {
    fontFamily: SANS,
    h1: { fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.01em" },
    h2: { fontSize: "1.375rem", fontWeight: 600, letterSpacing: "-0.005em" },
    h3: { fontSize: "1.125rem", fontWeight: 600 },
    subtitle1: { fontWeight: 500 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    body2: { lineHeight: 1.5 },
  },
  components: {
    MuiPaper: { defaultProps: { variant: "outlined", elevation: 0 } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 40 }, sizeLarge: { minHeight: 52, fontSize: "1rem" } },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 2, fontWeight: 500 } } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiCssBaseline: {
      styleOverrides: {
        ":root": { colorScheme: "light dark" },
        "@media (prefers-reduced-motion: reduce)": { "*": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" } },
        ":focus-visible": { outline: "3px solid var(--mui-palette-secondary-main)", outlineOffset: 2 },
      },
    },
  },
});
