# Paint catalogue

Reference lists used by the "Catalogue" tab to add paints to the inventory in bulk.
Each file is a JSON array of:

```json
{ "brand": "Citadel", "range": "Base", "name": "Macragge Blue", "type": "Base", "hex": "#0d407f" }
```

`type` and `hex` are optional. Colours are screen approximations collected from public colour
charts, not manufacturer data: correct them freely in your own inventory.

To add another brand without rebuilding the app, drop a file with the same shape into
`data/catalogs/` — it is picked up on the next page load.
