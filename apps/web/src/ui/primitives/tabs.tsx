import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "~/ui/utils.ts";

/**
 * In-page tabs: 44 px tall, the selected one has a 2 px amber bar on its bottom edge. Tabs that
 * change the URL (Recordings › Library / Scheduled / Problems) use `TabLinks` in `ui/page.tsx`
 * with the same look.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("grid", className)} {...props} />;
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("tabs", className)} {...props} />;
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return <TabsPrimitive.Tab data-slot="tabs-trigger" className={cn("tab", className)} {...props} />;
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
