export function farmerUrl(section = "overview", values: Record<string, string> = {}) {
  return workspaceUrl("farm", section, values);
}

export function consumerUrl(section = "overview", values: Record<string, string> = {}) {
  return workspaceUrl("consumer", section, values);
}

function workspaceUrl(view: string, section: string, values: Record<string, string>) {
  const params = new URLSearchParams({ view, section, ...values });
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  return `/?${params}`;
}

export function farmerDestination(link: string) {
  return workspaceDestination(link, farmerUrl, "farm");
}

export function consumerDestination(link: string) {
  return workspaceDestination(link, consumerUrl, "consumer");
}

function workspaceDestination(link: string, route: typeof farmerUrl, workspace: string) {
  const url = new URL(link, "http://workspace.local");
  if (url.origin !== "http://workspace.local" || url.pathname !== "/") return link;
  const view = url.searchParams.get("view");
  if (view === "enquiries" || view === "orders") return route("enquiries", { enquiry: url.searchParams.get("enquiry") || "" });
  if (view === "requests") return route("requests", { request: url.searchParams.get("request") || "" });
  if (view === "notifications") return route("notifications");
  if (view === workspace) return url.searchParams.has("section") ? link : route(workspace === "farm" ? "stock" : "overview");
  return link;
}
