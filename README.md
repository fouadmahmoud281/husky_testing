# Simple React App with AI Code Review

A very simple and beautiful React application with modern styling and AI-powered code review using Husky hooks.

## Features

- 🚀 Fast and lightweight
- 🎨 Beautiful glassmorphism design
- 📱 Fully responsive
- ⚡ Built with React 18
- 🤖 AI-powered code review with OpenAI
- 🔧 Pre-commit and pre-push hooks with Husky

## AI Code Review Setup

This project includes an intelligent code review system that uses OpenAI's GPT-4 to analyze your code changes before pushing.

### Configuration

1. Copy the environment template:
   ```
   copy .env.example .env
   ```

2. Add your OpenAI API key to `.env`:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

3. Optional: Customize AI settings in `.env`:
   ```
   OPENAI_MODEL=gpt-4
   MAX_TOKENS=1000
   ```

### How It Works

- **Pre-commit**: Runs tests to ensure code quality
- **Pre-push**: Triggers AI code review that analyzes your git diff and provides:
  - Code quality assessment
  - Security and bug detection
  - Performance recommendations
  - Best practices suggestions
  - React/JavaScript specific improvements

### AI Review Levels

- **GOOD**: Code looks great, push allowed
- **NEEDS_IMPROVEMENT**: Suggestions provided, push allowed
- **CRITICAL_ISSUES**: Serious issues detected, push blocked

Review logs are saved in `.husky/logs/` for future reference.

## Getting Started

1. Install dependencies:
   ```
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

## Available Scripts

- `npm start` - Runs the app in development mode
- `npm run build` - Builds the app for production
- `npm test` - Launches the test runner
- `npm run eject` - Ejects from Create React App (one-way operation)
- `npm run ai-review` - Manually trigger AI code review
- `npm run prepare` - Sets up Husky hooks (runs automatically after install)

## Project Structure

```
simple-react-app/
├── public/
│   └── index.html
├── src/
│   ├── App.js
│   ├── App.css
│   ├── index.js
│   └── index.css
├── package.json
└── README.md
```
