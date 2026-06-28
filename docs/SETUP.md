# WilliamOS Setup

## 1. Place the package

Recommended location:

```text
~/Documents/WilliamOS-devops
```

Keep it outside any TerraFusion repository.

## 2. Create Python environment

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 3. Initialize the vault

```bash
python scripts/william.py init
python scripts/william.py today
python scripts/william.py weekly
```

## 4. Open Obsidian

Open `WilliamOS/` as a vault.

## 5. Install plugins

Install these from Obsidian Community Plugins:

- Dataview
- Templater
- Tasks
- Calendar
- Periodic Notes
- QuickAdd
- Linter
- Omnisearch
- Excalidraw

## 6. Git governance

```bash
git init
git add .
git commit -m "Seed WilliamOS personal brain"
```

Recommended routine:

```bash
python scripts/william.py check
git add .
git commit -m "Weekly WilliamOS review YYYY-W##"
```

## 7. Optional: install CLI helpers

Recommended tools:

```text
git
ripgrep / rg
fd
fzf
bat
jq
pandoc
just
python
Graphify
```

## 8. Optional: Graphify

When Graphify is installed and on PATH:

```bash
python scripts/william.py graph
```

Start with selected folders before graphing the whole vault:

```bash
python scripts/william.py graph --target WilliamOS/03_Doctrine
python scripts/william.py graph --target WilliamOS/04_Appraisal
python scripts/william.py graph --target WilliamOS/05_Assessor_Office
python scripts/william.py graph --target WilliamOS/06_TerraFusion_Strategy
```
