import type { ComponentProps } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { useCopyToClipboard } from "@workspace/ui/hooks/use-copy-to-clipboard"
import { cn } from "@workspace/ui/lib/utils"

type CopyButtonProps = Omit<ComponentProps<typeof Button>, "children" | "onClick"> & {
  value: string
  label?: string
  copiedLabel?: string
  timeout?: number
  onCopied?: () => void
  iconClassName?: string
}

function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  timeout = 1800,
  onCopied,
  iconClassName,
  size = "icon-sm",
  variant = "outline",
  className,
  ...props
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard({ timeout })

  return (
    <Button
      aria-label={copied ? copiedLabel : label}
      className={cn(copied && "text-success", className)}
      onClick={() => {
        void copy(value).then((ok) => {
          if (ok) {
            onCopied?.()
          }
        })
      }}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {copied ? (
        <Check aria-hidden="true" className={iconClassName} />
      ) : (
        <Copy aria-hidden="true" className={iconClassName} />
      )}
    </Button>
  )
}

export { CopyButton }
