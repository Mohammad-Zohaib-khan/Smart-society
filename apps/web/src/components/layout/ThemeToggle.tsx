import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/button';
import { useThemeContext } from '@/providers';

export function ThemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useThemeContext();
  return (
    <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle} className={className}>
      {dark ? <Sun className="size-5" strokeWidth={1.5} /> : <Moon className="size-5" strokeWidth={1.5} />}
    </IconButton>
  );
}
