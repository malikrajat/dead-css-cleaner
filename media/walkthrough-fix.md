## Fix it in one click

Place the cursor on a highlighted selector and open the lightbulb (`Ctrl/Cmd + .`):

| Action | What it does |
| --- | --- |
| Remove this token | Deletes just the dead class/id from the selector |
| Remove the whole rule | Deletes the complete rule (offered when everything in it is dead) |
| Ignore this rule | Inserts `/* dead-css-ignore */` above the rule |
| Remove all dead selectors in this file | Cleans the whole file after a confirmation prompt |

Every edit goes through the normal undo stack, and analysis re-runs automatically
afterwards.
