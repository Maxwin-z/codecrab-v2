import { useNavigate, useSearchParams } from 'react-router'
import { FileBrowserPanel } from './FileBrowserPanel'

export function FileBrowserPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const path = searchParams.get('path') ?? ''

  const handleNavigate = (newPath: string) => {
    navigate(`?path=${encodeURIComponent(newPath)}`)
  }

  return (
    <div className="h-dvh flex bg-background text-foreground overflow-hidden">
      <FileBrowserPanel projectPath={path} fullPage onNavigate={handleNavigate} />
    </div>
  )
}
