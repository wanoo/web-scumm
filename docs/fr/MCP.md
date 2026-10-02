# MCP : le Studio pour n'importe quel assistant IA

`npm run mcp` lance un serveur [Model Context Protocol](https://modelcontextprotocol.io) en **stdio** qui expose les
opérations du Studio comme des outils. Claude Code, Claude Desktop, Cursor, Codex CLI, Gemini CLI ou un agent maison
lisent et modifient le jeu comme le Studio ; l'humain voit le résultat en direct dans `npm run studio`.

- Jeu : `GAME=<id>` (ou `GAME_DIR`), comme partout.
- Dans les configs, utiliser `npm run -s mcp` (silencieux) : sans `-s`, npm écrit sa bannière sur stdout.
- Une erreur (salle inconnue, chemin invalide…) devient une erreur d'outil ; le serveur continue.

## Outils
`list_rooms`, `get_room`, `set_layout`, `set_text` (`null` supprime, un chemin finissant par `[+]` ajoute une ligne),
`add_entity`, `get_storyboard`, `set_storyboard`, `get_notes`, `add_note` (auteur par défaut : le nom du client MCP),
`validate`, `solve`, `screenshot` (serveur de dev requis : `WEB_SCUMM_DEV_URL`, défaut `http://localhost:5173/`),
`read_doc` (CONTENT_GUIDE, ENGINE, TOOLS, STUDIO, WORKFLOW), `run_tests` et `asset_prompts` (les prompts d'images de
`npm run prompts`, `missing?` pour ne garder que ce qui manque ; les ids manquants en JSON structuré). Ressources : `webscumm://game`,
`webscumm://room/<id>`. Détail des arguments : [docs/en/MCP.md](../en/MCP.md).

## Brancher son client
- **Claude Code** : `.mcp.json` est fourni (portée projet) ; ou `claude mcp add web-scumm -- npm run -s mcp` dans le dépôt.
- **Claude Desktop** (`claude_desktop_config.json`) :
  `{ "mcpServers": { "web-scumm": { "command": "npm", "args": ["--prefix", "/chemin/web-scumm", "run", "-s", "mcp"] } } }`
- **Cursor** : `.cursor/mcp.json` est fourni (`--prefix ${workspaceFolder}`).
- **Codex CLI** (`~/.codex/config.toml`) :
  `[mcp_servers.web-scumm]` puis `command = "npm"` et `args = ["--prefix", "/chemin/web-scumm", "run", "-s", "mcp"]`.
- **Gemini CLI** (`settings.json`) :
  `{ "mcpServers": { "web-scumm": { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "/chemin/web-scumm" } } }`
- **Tout autre client** : commande `npm run -s mcp` dans le dossier du dépôt, transport stdio.
