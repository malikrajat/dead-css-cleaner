## Run an analysis

Three ways to start:

1. **Status bar** - click `Dead CSS Cleaner` in the bottom bar.
2. **Command Palette** (`Ctrl/Cmd + Shift + P`) - *Dead CSS Cleaner: Analyze Workspace for Dead CSS*.
3. **Keyboard** - `Ctrl + Alt + D` (Windows/Linux) or `Cmd + Alt + D` (macOS).

```text
$(sync~spin) Analysing CSS...   ->   $(warning) 12 dead CSS selectors
```

Analysis also runs automatically after a save, when you switch files, and when the file
watcher notices a new or deleted file (both configurable).
