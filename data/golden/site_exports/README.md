# Labeling site exports

Each file here is a "Download submitted labels" file from the labeling site's admin page, committed exactly as it was
downloaded. The label files listed beside it were made from it by `labeling-site/export_to_label_files.py`, which copies
the answers without judging them, in the same layout the labeling page writes.

The Checks workflow runs `python3 labeling-site/export_to_label_files.py --verify` on every pull request. It fails if an
export below was changed after it was committed (its sha256 no longer matches), if a `.json` file in this folder is not
listed in the table, if the table lists nothing, if a case the labeler saw on the site differs from the case record in
the repository, or if any listed label file differs by a single byte from what its listed export produces. Once merged,
the export files are also covered by the Checks rule that no locked label file on main is changed, renamed, or deleted.
New exports (another labeler's, say) are added as new files with a new row.

An export may hold other labelers' submissions too (for example a setup test on a practice case). Only the labeler id
in the table is used.

| export file | sha256 | labeler id | label file made | who | cases | notes |
|---|---|---|---|---|---|---|
| `submitted-labels-2026-10-25.json` | `d9b87cfe864f6a9a3db57b789f5d5cd14d065913715911882417e2552761e819` | `lb_d86cfa4745831c52` | `labels_blind.yaml` | Enlai Weng (credited as "Enlai", role Creator) | case_01 to case_12 | Blind labels, submitted on the site 2026-10-24 between 9:23 pm and 10:14 pm Pacific; exported 10:15 pm Pacific. The export's other entry, "Enlai (test)" on Practice A, is the site setup test and is not used. |
