// Picks the files worth reading for a setup guide, shrinks them to fit the AI's small
// free-tier limits, and formats the file list for the AI.

const README = /^readme(\.(md|markdown|rst|txt))?$/i;
const CONTRIBUTING = /^contributing(\.(md|markdown|rst|txt))?$/i;

// Files that say which language/tools a project uses and how to install it.
const MANIFESTS = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "pipfile",
  "go.mod", "cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts",
  "composer.json", "gemfile", "pubspec.yaml", "mix.exs",
]);

// Files that say how to configure or run it.
const CONFIGS = new Set([
  "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yaml",
  "makefile", ".env.example", ".env.sample", ".env.template",
  ".nvmrc", ".python-version", ".tool-versions", "procfile",
]);

// Manifests one folder deep (for projects split into client/ and server/).
const NESTED = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "go.mod",
  "cargo.toml", "pom.xml", "dockerfile",
]);

// README headings worth keeping when the README is too long.
const RELEVANT_HEADING =
  /install|setup|set up|getting started|quick ?start|usage|running|run |build|develop|contribut|environment|config|prerequisite|requirement|troubleshoot|faq|docker|deploy/i;

const MAX_KEY_FILES = 12;

const baseName = (path) => path.split("/").pop().toLowerCase();
const depth = (path) => path.split("/").length - 1;
const cut = (text, max) => (text.length > max ? text.slice(0, max) + "\n[file cut off here]" : text);

export const isReadme = (path) => README.test(path.split("/").pop());
export const isManifest = (path) => MANIFESTS.has(baseName(path));

// Returns [{ path, maxChars }] for the files to read, most important first.
// maxChars is how much to DOWNLOAD. Shrinking for the AI happens later (condenseFile).
export function pickKeyFiles(files) {
  const picked = [];
  const add = (path, maxChars) => {
    if (picked.length < MAX_KEY_FILES && !picked.some((p) => p.path === path)) {
      picked.push({ path, maxChars });
    }
  };

  const root = files.filter((f) => !f.path.includes("/"));

  const readme = root.find((f) => README.test(f.path));
  if (readme) add(readme.path, 30000);

  const contributing = files.find(
    (f) => CONTRIBUTING.test(f.path) || CONTRIBUTING.test(f.path.replace(/^\.github\//i, ""))
  );
  if (contributing) add(contributing.path, 8000);

  for (const f of root) if (MANIFESTS.has(f.path.toLowerCase())) add(f.path, 20000);
  for (const f of root) if (CONFIGS.has(f.path.toLowerCase())) add(f.path, 4000);

  const nested = files
    .filter((f) => depth(f.path) === 1 && NESTED.has(baseName(f.path)))
    .slice(0, 4);
  for (const f of nested) add(f.path, 20000);

  return picked;
}

// Keeps the start of a long README plus the sections about installing and running.
// Headings inside ``` code blocks are ignored (they are usually shell comments).
export function condenseReadme(text, max = 3500) {
  if (text.length <= max) return text;

  const sections = [{ heading: "", lines: [] }];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,4}\s/.test(line)) {
      sections.push({ heading: line, lines: [line] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const intro = sections
    .slice(0, 2)
    .map((s) => s.lines.join("\n"))
    .join("\n")
    .trim()
    .slice(0, 600);

  let out = intro;
  let added = false;
  for (const s of sections.slice(2)) {
    if (!RELEVANT_HEADING.test(s.heading)) continue;
    const block = s.lines.join("\n");
    const room = max - out.length - 2;
    if (room < 200) break;
    out += "\n\n" + (block.length > room ? block.slice(0, room) + "\n[section cut off here]" : block);
    added = true;
  }
  if (!added) return cut(text, max); // no useful headings: just take the start
  return out + "\n\n[other README sections left out]";
}

// For package.json, keep only what matters for setup: scripts, engines, and dependency names.
function condensePackageJson(text, max) {
  try {
    const pkg = JSON.parse(text);
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const summary = {
      name: pkg.name,
      description: pkg.description,
      scripts: pkg.scripts,
      engines: pkg.engines,
      packageManager: pkg.packageManager,
      workspaces: pkg.workspaces,
      dependencyNames: deps.slice(0, 40),
    };
    return cut(JSON.stringify(summary, null, 1), max);
  } catch {
    return cut(text, max);
  }
}

// Shrinks one file to a size that suits its type.
export function condenseFile(path, text) {
  const name = baseName(path);
  if (isReadme(path)) return condenseReadme(text, 3500);
  if (CONTRIBUTING.test(path.split("/").pop())) return cut(text, 1200);
  if (name === "package.json") return condensePackageJson(text, 1800);
  if (MANIFESTS.has(name)) return cut(text, 1000);
  return cut(text, 800);
}

// Makes sure all files together stay under `total` characters. Earlier files win.
export function fitToBudget(files, total = 7500) {
  let left = total;
  const out = [];
  for (const f of files) {
    if (left < 200) break;
    const text = f.text.length > left ? f.text.slice(0, left) + "\n[file cut off here]" : f.text;
    out.push({ path: f.path, text });
    left -= text.length;
  }
  return out;
}

// A plain-text file list, shallow files first, cut off at `limit` paths or `maxChars` characters.
export function buildTreeText(files, limit = 100, maxChars = 3000) {
  const sorted = files
    .map((f) => f.path)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));

  const shown = [];
  let chars = 0;
  for (const path of sorted.slice(0, limit)) {
    if (chars + path.length + 1 > maxChars) break;
    shown.push(path);
    chars += path.length + 1;
  }

  let text = shown.join("\n");
  if (shown.length < sorted.length) {
    text += `\n... (${sorted.length - shown.length} more files not shown)`;
  }
  return text;
}
