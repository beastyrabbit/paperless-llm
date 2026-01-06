"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import {
  cn,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Badge,
} from "@repo/ui"

interface Model {
  name: string
  value?: string  // Optional: if provided, use as value instead of name
  size?: string
}

interface ModelComboboxProps {
  models: Model[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
}

export function ModelCombobox({
  models,
  value,
  onValueChange,
  placeholder = "Select model...",
  searchPlaceholder = "Search models...",
  emptyText = "No model found.",
  disabled = false,
}: ModelComboboxProps) {
  const [open, setOpen] = React.useState(false)

  const getModelValue = (model: Model) => model.value ?? model.name
  const selectedModel = models.find((model) => getModelValue(model) === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <div className="flex items-center gap-2 truncate">
              <span className="truncate">{selectedModel?.name ?? value}</span>
              {selectedModel?.size && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {selectedModel.size}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {models.map((model, index) => {
                const modelValue = getModelValue(model)
                return (
                  <CommandItem
                    key={`${modelValue}-${index}`}
                    value={model.name}
                    onSelect={() => {
                      onValueChange(modelValue === value ? "" : modelValue)
                      setOpen(false)
                    }}
                  >
                    <div className="flex items-center justify-between w-full gap-2">
                      <span className="truncate">{model.name}</span>
                      {model.size && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {model.size}
                        </Badge>
                      )}
                    </div>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4 shrink-0",
                        value === modelValue ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
