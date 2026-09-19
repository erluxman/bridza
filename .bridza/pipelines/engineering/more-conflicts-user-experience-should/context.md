# More conflicts, user experience should be easier.

Alright, so when this merge conflict opens that, so when we are trying to merge it to May, if there is a conflict in it, open that particular branch with that particular command in VSCode, so that I can fix it from the VSCode or open the merge conflict UI from VSCode, whatever will be the best idea. So basically I want to be able to merge it from this app, like it is driven by this app rather than practically going to open the terminal because I know that I should be fixing from the terminal, but not everybody may be informed enough for that.


For additional information, do research on how to make the merge config or merging issue easy, like also take a reference of GitHub's config resolution DY as well If it's easy to be resolved on the UI of this app itself, do that Otherwise, direct me to, redirect me to VS code with necessary parameters already provided there so that I can just select what is to be selected or delete or add

## KNOWN HOT FILE (added after #36)

`.bridza/refs.json` is now the most likely recurring conflict in this repo: it
is a single JSON file at the repo root, on the base branch, rewritten by every
`#ref` assignment, every task/pipeline delete, and — since #36 — every archive
or unarchive click, from every device that syncs.

Use it as the first concrete test case for whatever conflict UX this task
builds: two devices archiving different cards is a realistic, reproducible
conflict with an obvious correct resolution (union of both maps). If the UI can
resolve that class automatically, most refs.json conflicts disappear.

