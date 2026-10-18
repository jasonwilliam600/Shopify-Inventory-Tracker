import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeSelector() {
  const { theme = "system", setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <label className="flex shrink-0 items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        className="min-w-0 bg-transparent text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        value={theme}
        onChange={event => setTheme(event.target.value)}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
