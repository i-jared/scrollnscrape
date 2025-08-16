# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Plasmo browser extension called "Scrollnscrape" - an X.com (Twitter) profile scraper extension. The project is built with TypeScript, React, and the Plasmo framework.

## Development Commands

- `npm run dev` or `pnpm dev` - Start development server
- `npm run build` or `pnpm build` - Create production build
- `npm run package` - Package extension for distribution

## Architecture

- **Framework**: Plasmo (browser extension framework)
- **Frontend**: React 18 + TypeScript
- **Entry Point**: `popup.tsx` - Main extension popup interface
- **Build Output**: `build/` directory with browser-specific builds (e.g., `build/chrome-mv3-dev`)
- **Permissions**: Extension has broad host permissions (`https://*/*`) for web scraping

## Development Workflow

1. Run `npm run dev` to start development
2. Load the extension from `build/chrome-mv3-dev` (or appropriate browser build) in your browser
3. The popup auto-updates on code changes
4. Add `options.tsx` for options page, `content.ts` for content scripts

## Key Files

- `popup.tsx` - Main popup component
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration extending Plasmo base
- `assets/icon.png` - Extension icon

## Path Aliases

- `~*` maps to `./*` (root directory alias)