const meta = {
  name: 'recreate-lovable-maet',
  description: 'Recreate Lovable TradingView-inspired MAET website with parallel agents',
  phases: [
    { title: 'Explore & Audit', detail: 'Analyze current state and Lovable requirements' },
    { title: 'Routes & Pages', detail: 'Create all Lovable route pages in parallel' },
    { title: 'Components & Hooks', detail: 'Build reusable components and hooks' },
    { title: 'Integrate & Verify', detail: 'Wire everything together and test' }
  ]
}

// Main workflow logic
async function recreateLovableMaet(arg) {
  const { log, phase } = imports

  phase('Explore & Audit')

  // Agent 1: Explore current codebase structure
  const currentStructure = await agent(
    `Explore the MAET project at C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET and report:
  1. Current route files in src/routes/
  2. Current components in src/components/
  3. Current hooks in src/hooks/
  4. Current lib utilities in src/lib/
  5. The sidebar navigation structure in src/components/app-sidebar.tsx

  List EXACTLY what exists vs what's missing for a complete TradingView-inspired interface.`,
    { label: 'explore-structure', phase: 'Explore & Audit' }
  )

  // Agent 2: Analyze Lovable requirements from docs
  const lovelyRequirements = await agent(
    `Read the files at:
  - C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\docs\\api-contracts\\*.md
  - C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\docs\\endpoint-registry.md
  - C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\docs\\smoke-test-checklist.md

  Extract and list ALL routes, pages, and components that need to exist for the Lovable TradingView-inspired interface.
  Include: alerts, chart-grid, compare, futures, heatmap, news, options, settings, universe, screener, strategies, etc.`,
    { label: 'analyze-requirements', phase: 'Explore & Audit' }
  )

  // Agent 3: Check existing design patterns
  const designPatterns = await agent(
    `Analyze the existing MAET codebase patterns:
  1. Read src/components/app-shell.tsx or similar shell component
  2. Read a few existing route files like src/routes/_app.dashboard.tsx
  3. Read src/lib/utils.ts for utility patterns
  4. Check how components use DataBadge, EmptyState, ContractPanel

  Report the coding patterns, imports, and component structure to maintain consistency.`,
    { label: 'analyze-patterns', phase: 'Explore & Audit' }
  )

  phase('Routes & Pages')

  log('Creating all Lovable route pages in parallel...')

  // Create all missing routes in parallel
  const routesToCreate = [
    'alerts',
    'chart-grid',
    'compare',
    'futures',
    'heatmap',
    'news',
    'settings',
    'universe'
  ]

  const routeAgents = routesToCreate.map(routeName =>
    agent(
      `Create the file C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src\\routes\\${routeName}.tsx following these specs:

    1. Import from "@tanstack/react-router" and use createFileRoute
    2. Set appropriate head meta title
    3. Create a functional component that matches the TradingView-inspired design
    4. Use components from "@/components/ui/" and "@/components/common/"
    5. Include proper TypeScript types
    6. For data placeholders, use EmptyState and ContractPanel with appropriate messages
    7. Make it visually match a professional trading terminal interface

    The route should be: /${routeName}
    For params routes like /options/$underlying, use the proper TanStack syntax.

    Write the complete file content following the existing patterns in src/routes/_app.dashboard.tsx`,
      { label: `create-${routeName}-route`, phase: 'Routes & Pages' }
    ).then(result => ({ route: routeName, result }))
  )

  const routesResults = await parallel(routeAgents)

  phase('Components & Hooks')

  log('Creating common components and hooks...')

  // Create common components
  const commonComponents = [
    'data-badge',
    'empty-state',
    'contract-panel'
  ]

  const componentAgents = commonComponents.map(compName =>
    agent(
      `Create the file C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src\\components\\common\\${compName}.tsx

    This should be a reusable component used across the Lovable interface.
    Make it follow shadcn/ui patterns with proper TypeScript types and variants.

    For data-badge: Show live/delayed/mock/pending status badges
    For empty-state: Show placeholder states with optional action buttons
    For contract-panel: Show "backend endpoint pending" informational panels

    Use lucide-react for icons and tailwind for styling.`,
      { label: `create-${compName}-component`, phase: 'Components & Hooks' }
    ).then(result => ({ component: compName, result }))
  )

  const componentsResults = await parallel(componentAgents)

  // Create trading-specific components
  const tradingComponents = [
    'live-mini-chart',
    'market-catalog',
    'skeleton-loader'
  ]

  const tradingAgents = tradingComponents.map(compName =>
    agent(
      `Create the file C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src\\components\\trading\\${compName}.tsx

    This should be a trading-specific component.
    Make it professional and performance-optimized for real-time data display.

    For live-mini-chart: A sparkline/candlestick mini chart component
    For market-catalog: Display market/instrument catalog data
    For skeleton-loader: Loading skeletons for trading data

    Use recharts or lightweight canvas for charts, proper TypeScript types.`,
      { label: `create-${compName}-trading`, phase: 'Components & Hooks' }
    ).then(result => ({ component: compName, result }))
  )

  const tradingResults = await parallel(tradingAgents)

  // Create hooks
  const hooksToCreate = [
    'use-market-quotes',
    'use-market-candles',
    'use-paper-account'
  ]

  const hooksAgents = hooksToCreate.map(hookName =>
    agent(
      `Create the file C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src\\hooks\\${hookName}.ts

    This should be a React hook for managing trading data.

    For use-market-quotes: Fetch real-time quote data with polling/SSE
    For use-market-candles: Fetch OHLCV candle data for charts
    For use-paper-account: Manage paper trading account state

    Use TanStack Query (useQuery, useMutation) for data fetching.
    Include proper error handling, loading states, and TypeScript types.
    Interface with the API endpoints defined in the endpoint registry.`,
      { label: `create-${hookName}-hook`, phase: 'Components & Hooks' }
    ).then(result => ({ hook: hookName, result }))
  )

  const hooksResults = await parallel(hooksAgents)

  phase('Integrate & Verify')

  log('Integrating components and updating configurations...')

  // Update sidebar navigation
  const sidebarUpdate = await agent(
    `Update the file C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src\\components\\app-sidebar.tsx

  Add navigation items for all the new Lovable routes:
  - Alerts
  - Chart Grid
  - Compare
  - Futures
  - Heatmap
  - News
  - Settings
  - Universe

  Match the existing navigation pattern with proper icons from lucide-react.
  Organize them logically in groups (Trading, Analysis, Discovery, etc.).

  Write the complete updated file content.`,
    { label: 'update-sidebar', phase: 'Integrate & Verify' }
  )

  // Update route tree
  const routeTreeUpdate = await agent(
    `Run the TanStack Router CLI to regenerate the route tree:

  Execute: bunx @tanstack/router-cli generate

  This should be run from the project root C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET

  Report any conflicts or errors that occur during generation.`,
    { label: 'regenerate-routes', phase: 'Integrate & Verify' }
  )

  // Verify build
  const buildVerify = await agent(
    `Run a build verification:

  1. cd C:\\Users\\TANMAY\\OneDrive\\Desktop\\MAET\\src
  2. bun run build

  Report the full build output. If there are errors:
  - List each error with file and line number
  - Identify if errors are type errors, build errors, or missing dependencies

  If build succeeds, report the size of the output and any warnings.`,
    { label: 'verify-build', phase: 'Integrate & Verify' }
  )

  // Final summary
  log('Generating final summary...')

  return {
    structure: currentStructure,
    requirements: lovelyRequirements,
    patterns: designPatterns,
    routes: routesResults.filter(r => r.result).map(r => r.route),
    components: [...componentsResults, ...tradingResults].filter(r => r.result).map(r => r.component),
    hooks: hooksResults.filter(r => r.result).map(r => r.hook),
    sidebar: sidebarUpdate,
    build: buildVerify,
    summary: {
      totalRoutesCreated: routesResults.filter(r => r.result).length,
      totalComponentsCreated: [...componentsResults, ...tradingResults].filter(r => r.result).length,
      totalHooksCreated: hooksResults.filter(r => r.result).length,
      buildStatus: buildVerify?.includes('built in') ? 'SUCCESS' : 'FAILED'
    }
  }
}
