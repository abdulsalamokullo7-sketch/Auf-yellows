@echo off
cd /d "%~dp0"
echo Open http://localhost:8080 in your browser (PWA + offline shell need HTTP, not file://)
echo Press Ctrl+C to stop.
python -m http.server 8080 2>nul || py -m http.server 8080 2>nul || echo Install Python or run: npx --yes serve -l 8080 .
