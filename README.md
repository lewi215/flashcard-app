# Flashcard App

An Obsidian flashcard PWA — generates Anki-style study cards from your Obsidian vault using AI (Claude or GPT-4).

## Requirements

- [Python 3.10+](https://www.python.org/downloads/)
- An [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/) API key
- An Obsidian vault (a folder of `.md` files)

## Setup

**1. Clone the repo**

```
git clone https://github.com/lewi215/flashcard-app.git
cd flashcard-app
```

**2. Create a virtual environment and install dependencies**

```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**3. Run the app**

```
python app.py
```

Then open your browser to **http://localhost:5000**

**4. Configure the app**

On first launch, go to Settings in the app and enter:
- The path to your Obsidian vault (e.g. `C:\Users\YourName\Documents\MyVault`)
- Your Anthropic or OpenAI API key

Your settings are saved locally to `config.json` and are never uploaded anywhere.

---

## Optional: Run automatically on Windows login

If you want the app to start in the background whenever you log into Windows:

**Option A — One command (PowerShell, run as your user)**

```powershell
$action = New-ScheduledTaskAction -Execute "$PWD\start.bat"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "FlashcardApp" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force
```

Run this from inside the `flashcard-app` folder. The app will launch silently on every login and log output to `logs\app.log`.

**Option B — Startup folder (simpler, no admin needed)**

1. Press `Win + R`, type `shell:startup`, hit Enter
2. Create a shortcut to `start.bat` in that folder

**To stop auto-start:** Open Task Scheduler, find "FlashcardApp", and delete or disable it. Or remove the shortcut from the Startup folder if you used Option B.

---

## Notes

- The app runs locally on your machine — no data leaves your computer except the text sent to the AI provider when generating cards.
- API keys are stored in `config.json` which is excluded from git via `.gitignore`.
- Logs are written to `logs\app.log` when using auto-start.
