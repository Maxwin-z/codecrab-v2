export function HomePage(_: { onUnauthorized?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 select-none">
      <div className="text-center space-y-3">
        <img src="/codecrab.png" alt="CodeCrab" className="w-12 h-12 rounded-xl mx-auto opacity-40" />
        <p className="text-sm text-muted-foreground">Select a project or agent to get started</p>
      </div>
    </div>
  )
}
