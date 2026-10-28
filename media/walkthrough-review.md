## Read the findings

Findings land in the **Problems** panel (`Ctrl/Cmd + Shift + M`) with a squiggle on the
exact class or id name - not on the whole rule.

```
Dead CSS class: .hero__subtitle - not found in any scanned file
Selector: .hero .hero__subtitle
This selector is only partially dead: 1 of 2 tokens in this rule are still used.
Scanned 4 CSS file(s), 12 script file(s), 3 markup file(s), 2 Angular component(s).
```

Related information under each problem links to the places where the selector **is**
used, so you can confirm before deleting.

### ...or read the whole list

Open **Dead CSS Cleaner** in the activity bar (view *Dead CSS by component*) to browse every
dead class grouped by the component that owns the stylesheet. Each entry shows the full
nested selector chain, the scope that was validated (the component plus its child
components) and, when it applies, where the class is still used elsewhere.

For a shareable version, run *Dead CSS Cleaner: Show Dead CSS Report (grouped by component)*,
or *Copy Dead CSS List* to paste `file:line  .class  (selector: ...)` lines into a ticket.
