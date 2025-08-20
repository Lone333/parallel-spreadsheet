# Parallel Spreadsheet

This is a [Next.js](https://nextjs.org) project that provides AI-powered spreadsheet enrichment using [Parallel AI](https://parallel.ai) for live web research.

https://github.com/user-attachments/assets/131235f5-45a6-4d2b-9038-97e66b3566fc

## Getting Started

First, create a `.env.local` file with your Parallel API key:

```bash
PARALLEL_API_KEY=your_api_key_here
```

Then, install the dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- **AI-Powered Enrichment**: Select cells and enrich them with live web research data
- **Multiple Processors**: Choose from Lite, Base, Core, or Pro processors for different research depths
- **Real-time Updates**: Stream results directly into selected cells with progress indicators
- **Keyboard Shortcuts**: Productivity-focused shortcuts for common operations
- **Dark Mode Interface**: Modern, easy-on-the-eyes spreadsheet interface

## Usage

1. **Select Cells**: Click and drag to select the cells you want to enrich
2. **Choose Processor**: Select the research depth (Lite for quick lookups, Pro for comprehensive research)
3. **Click Enrich**: Press the Enrich button or use ⌘↵ to start the AI research
4. **Watch Results Stream**: See cells populate in real-time as research completes

### Keyboard Shortcuts

- `⌘K` - Add Column
- `⌘J` - Add Row  
- `⌘↵` - Enrich Selection
- `⌘⌫` - Delete Column/Row (when selected)
- `Esc` - Clear Selection

### Processor Modes

- **Lite**: Basic information retrieval
- **Base**: Simple web research
- **Core**: Complex web research
- **Pro**: Exploratory web research

## Learn More

To learn more about the technologies used:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API
- [Parallel AI Documentation](https://docs.parallel.ai) - learn about Parallel's AI research capabilities
- [React Spreadsheet](https://github.com/iddan/react-spreadsheet) - the spreadsheet component library

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Technical Notes

- **API Integration**: The app uses `app/api/parallel/route.ts` to proxy task group creation and SSE events
- **Styling**: Styles are organized in `app/page.css` for maintainability
- **State Management**: React hooks manage spreadsheet state and real-time updates