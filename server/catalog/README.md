# Paint catalogue

Reference lists used by the "Catalogue" tab to add paints to the inventory in bulk.
Each file is a JSON array of:

```json
{ "brand": "Citadel", "range": "Base", "name": "Macragge Blue", "type": "Base", "hex": "#0d407f" }
```

`type`, `code` (manufacturer reference) and `hex` are optional.

## Where the bundled lists come from

`citadel.json`, `army-painter.json` (Warpaints Fanatic) and `ak-interactive.json` (3rd Gen Acrylics)
were compiled in November 2026 from the public range pages of [PaintPad](https://paintpad.app/paints).
Product names belong to their manufacturers and are used here only to identify the paints.
Colours are screen approximations, not manufacturer data: correct them freely in your own inventory.
A few entries have no colour and show as an empty pot. Ranges not listed (for example Speedpaint)
can be added with the CSV import or with your own file, as described below.

To add another brand without rebuilding the app, drop a file with the same shape into
`data/catalogs/` — it is picked up on the next page load.
