"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bell, ChevronDown, ClipboardList, LayoutGrid, LoaderCircle, MapPin, Package, Plus, Search, Store, Tractor } from "lucide-react";
import { api, ApiError, label, money, type CartItem, type DataPage, type Enquiry, type Hub, type InboxData, type Listing, type ListingPage, type ProduceRequest, type User } from "@/lib/api";
import { consumerDestination, consumerUrl, farmerDestination, farmerUrl } from "@/lib/workspace";
import { quantityStep, validQuantity } from "@/lib/quantity";
import { FeedbackContext, Field as Control, focusFormError } from "./forms";
import { ListingPagination } from "./pagination";

export const connectionNotice = "Arrange payment, collection and delivery directly with the farmer. SokoSoo does not manage these arrangements.";
const dateTime = (value: string) => new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
const fields = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget).entries());

function ErrorMessage({ error }: { error: string }) {
  return error ? <p className="error-banner" role="alert">{error}</p> : null;
}
function useAction(updated: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  async function run(operation: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setFieldErrors({});
    try { await operation(); updated(); }
    catch (cause) {
      const fields = cause instanceof ApiError ? cause.fields : {};
      setError(cause instanceof Error ? cause.message : "The action failed. Please try again.");
      setFieldErrors(fields);
      if (form.current) focusFormError(form.current, fields);
    }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, run, fieldErrors, setFieldErrors, form, reset: () => { setError(""); setFieldErrors({}); } };
}
function ActionForm({ action, children, ...props }: Omit<ComponentProps<"form">, "action"> & { action: ReturnType<typeof useAction> }) {
  return <FeedbackContext.Provider value={{ error: action.error, notice: "", fields: action.fieldErrors, form: action.form.current }}>
    <form {...props} ref={action.form} onChangeCapture={event => {
      const target = event.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && action.fieldErrors[target.name]) {
        action.setFieldErrors(current => { const next = { ...current }; delete next[target.name]; return next; });
      }
    }}>{children}</form>
  </FeedbackContext.Provider>;
}
function useData<T>(path: string, version: number) {
  const [state, setState] = useState<{ data?: T; loading: boolean; error: string }>({ loading: true, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "" });
    api<T>(path).then(data => { if (active) setState({ data, loading: false, error: "" }); })
      .catch(cause => { if (active) setState({ loading: false, error: cause instanceof Error ? cause.message : "Could not load this information." }); });
    return () => { active = false; };
  }, [path, version, retry]);
  return { ...state, retry: () => setRetry(value => value + 1) };
}
function LoadFeedback({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return loading ? <p className="loading-state" role="status"><LoaderCircle className="spinner"/> Loading...</p>
    : <div className="empty-state"><ErrorMessage error={error}/><button className="secondary-button" onClick={retry}>Try again</button></div>;
}

type TableFilter = { name: string; title: string; allTitle?: string; options?: { value: string; title: string }[] };
function TableFilters({ filters }: { filters: TableFilter[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const cleared = new URLSearchParams(params.toString());
  for (const filter of filters) cleared.delete(filter.name);
  for (const key of ["page", "stock_page", "offer_page", "notification_cursor", "notification_snapshot"]) cleared.delete(key);
  return <form key={filters.map(filter => `${filter.name}:${params.get(filter.name) || ""}`).join("|")} className="workspace-filters" role="search" aria-label="Search and filter records" onSubmit={event => {
    event.preventDefault();
    const next = new URLSearchParams(cleared);
    for (const [key, value] of new FormData(event.currentTarget)) if (String(value).trim()) next.set(key, String(value).trim());
    router.push(`/?${next}`, { scroll: false });
  }}>
    {filters.map(filter => <Control title={filter.title} key={filter.name}>{filter.options
      ? <select name={filter.name} aria-label={filter.title} defaultValue={params.get(filter.name) || ""}><option value="">{filter.allTitle || "All"}</option>{filter.options.map(option => <option value={option.value} key={option.value}>{option.title}</option>)}</select>
      : <input name={filter.name} type="search" defaultValue={params.get(filter.name) || ""} placeholder={filter.title}/>}</Control>)}
    <button className="secondary-button" type="submit"><Search size={16}/> Apply</button>
    {filters.some(filter => params.get(filter.name)) && <Link className="text-button" href={`/?${cleared}`}>Clear filters</Link>}
  </form>;
}

function RecordTable({ caption, headings, children }: { caption: string; headings: string[]; children: ReactNode }) {
  return <div className="workspace-table" tabIndex={0} role="region" aria-label={caption}><table style={{ minWidth: Math.max(680, headings.length * 100) }}><caption className="sr-only">{caption}</caption><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

const categoryOptions = [
  { value: "vegetables", title: "Vegetables" }, { value: "fruits", title: "Fruits" },
  { value: "dairy", title: "Dairy & eggs" }, { value: "grains", title: "Grains & pulses" },
  { value: "livestock", title: "Livestock" }, { value: "byproducts", title: "Byproducts" },
];
const stockOptions = [
  { value: "active", title: "Available" }, { value: "review", title: "Hidden / archived" },
  { value: "out_of_stock", title: "Out of stock" }, { value: "in_transit", title: "Awaiting receipt" },
];
function stockStatus(item: Listing) {
  if (item.channel === "hub" && !item.received) return "Awaiting receipt";
  if (item.state === "archived" || new Date(item.available_until).getTime() <= Date.now()) return "Hidden / archived";
  return Number(item.available) > 0 ? "Available" : "Out of stock";
}

function WorkspaceLayout({ title, section, navigation, url, unreadCount, children }: {
  title: string; section: string; navigation: { id: string; title: string; icon: typeof LayoutGrid }[];
  url: typeof farmerUrl; unreadCount: number; children: ReactNode;
}) {
  const params = useSearchParams();
  const content = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const destination = [params.get("batch"), params.get("enquiry"), params.get("request"), params.get("offer"), params.get("notification")].join(":");
  const page = params.get("page");
  const filters = ["q", "category", "stock_status", "status", "hub", "offers", "inbox_q", "kind", "direction", "has_offers", "offer_q", "offer_sort", "offer_page"].map(key => params.get(key) || "").join("|");
  useEffect(() => { content.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }); }, [section, destination, page, filters]);
  const links = navigation.map(item => <Link key={item.id} href={url(item.id)} onClick={() => menu.current?.removeAttribute("open")} aria-current={section === item.id ? "page" : undefined}><item.icon size={18}/>{item.title}{item.id === "notifications" && unreadCount > 0 && <span className="workspace-unread">{unreadCount}</span>}</Link>);
  return <div className="farmer-layout">
    <aside className="farmer-sidebar"><nav aria-label={title}>{links}</nav></aside>
    <details ref={menu} className="farmer-mobile-menu"><summary>Workspace menu <ChevronDown size={17}/></summary><nav aria-label={title}>{links}</nav></details>
    <div ref={content} className="farmer-content">{children}</div>
  </div>;
}

export function FarmerWorkspace({ user, hubs, version, updated, notificationVersion, notificationUpdated, latestId, unreadCount, listingForm }: {
  user: User; hubs: Hub[]; version: number; updated: () => void; notificationVersion: number; notificationUpdated: () => void; latestId: number; unreadCount: number; listingForm: ReactNode;
}) {
  const params = useSearchParams();
  const legacyView = params.get("view");
  const section = legacyView === "orders" ? "enquiries" : legacyView !== "farm" ? legacyView || "overview" : params.get("section") || "overview";
  const navigation = [
    { id: "overview", title: "Overview", icon: LayoutGrid },
    { id: "stock", title: "Produce & stock", icon: Tractor },
    { id: "enquiries", title: "Buyer enquiries", icon: Package },
    { id: "requests", title: "Buyer requests & offers", icon: ClipboardList },
    { id: "transfers", title: "Hub stock & transfers", icon: Store },
    { id: "notifications", title: "Notifications", icon: Bell },
  ];
  return <WorkspaceLayout title="Farmer workspace" section={section === "new" ? "stock" : section} navigation={navigation} url={farmerUrl} unreadCount={unreadCount}>
      {section === "overview" ? <FarmerOverview version={version}/>
        : section === "stock" || section === "transfers" ? <FarmerStock key={section} user={user} hubs={hubs} version={version} updated={updated} transfers={section === "transfers"}/>
        : section === "enquiries" ? <WorkspaceEnquiries user={user} version={version} updated={updated}/>
        : section === "requests" ? <FarmerRequests user={user} version={version} updated={updated}/>
        : section === "notifications" ? <Inbox key={`${user.id}:${params}`} user={user} version={notificationVersion} updated={notificationUpdated} latestId={latestId} unreadCount={unreadCount}/>
        : section === "new" ? <section className="workspace"><Link className="back-link" href={farmerUrl("stock")}><ArrowLeft size={16}/> Back to produce & stock</Link><div className="section-heading"><h1 tabIndex={-1}>Add produce</h1></div><div className="workspace-form">{listingForm}</div></section>
        : <section className="empty-state"><h1 tabIndex={-1}>Workspace view not found</h1><Link href={farmerUrl()}>Return to overview</Link></section>}
  </WorkspaceLayout>;
}

function FarmerOverview({ version }: { version: number }) {
  const resource = useData<{ pending_enquiries: number; hidden: number; awaiting_receipt: number }>("farmer-workspace/", version);
  const tasks = resource.data ? [
    { title: "Buyer enquiries awaiting your reply", count: resource.data.pending_enquiries, href: farmerUrl("enquiries", { status: "pending" }), action: "Review enquiries" },
    { title: "Hidden or archived listings", count: resource.data.hidden, href: farmerUrl("stock", { stock_status: "review" }), action: "Review stock" },
    { title: "Hub batches awaiting receipt", count: resource.data.awaiting_receipt, href: farmerUrl("transfers", { stock_status: "in_transit" }), action: "View transfers" },
  ] : [];
  return <section className="workspace"><div className="section-heading"><div><h1 tabIndex={-1}>Farm overview</h1><p>Your stock, buyer conversations and hub transfers.</p></div><Link className="primary-button" href={farmerUrl("new")}><Plus size={17}/> Add produce</Link></div>
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : <RecordTable caption="Farm tasks" headings={["Task", "Records", "Actions"]}>{tasks.map(task => <tr key={task.title}><th scope="row">{task.title}</th><td>{task.count}</td><td><Link className="text-button" href={task.href}>{task.action} <ArrowRight size={15}/></Link></td></tr>)}</RecordTable>}
  </section>;
}

function FarmerStock({ user, hubs, version, updated, transfers }: { user: User; hubs: Hub[]; version: number; updated: () => void; transfers: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const batch = params.get("batch");
  const query = new URLSearchParams({ mine: "true" });
  if (batch) query.set("ids", batch);
  else {
    query.set("page", params.get("page") || "1");
    for (const key of ["q", "category", "stock_status", "hub"]) if (params.get(key)) query.set(key, params.get(key)!);
    if (transfers) query.set("channel", "hub");
  }
  const resource = useData<ListingPage | Listing[]>(`listings/?${query}`, version);
  const [feedback, setFeedback] = useState("");
  const listParams = new URLSearchParams(params.toString()); listParams.delete("batch");
  const listUrl = `/?${listParams}`;
  const data = resource.data && !Array.isArray(resource.data) ? resource.data : undefined;
  const item = Array.isArray(resource.data) ? resource.data[0] : undefined;
  function recordUrl(id: number) { const next = new URLSearchParams(listParams); next.set("batch", String(id)); return `/?${next}`; }
  const title = transfers ? "Hub stock & transfers" : "Produce & stock";
  return <section className="workspace">
    {batch && <Link className="back-link" href={listUrl}><ArrowLeft size={16}/> Back to {title.toLowerCase()}</Link>}
    <div className="section-heading"><div><h1 tabIndex={-1}>{batch ? "Batch details" : title}</h1>{!batch && <p>{transfers ? "Follow dispatches and confirmed hub balances." : "Keep your listings and available quantities up to date."}</p>}</div>{!batch && <Link className="primary-button" href={farmerUrl("new")}><Plus size={17}/> Add produce</Link>}</div>
    {feedback && <p className="inbox-feedback" role="status">{feedback}</p>}
    {!batch && <TableFilters filters={[{ name: "q", title: "Search produce or location" }, { name: "category", title: "Category", options: categoryOptions }, { name: "stock_status", title: "Stock status", options: stockOptions }, ...(transfers ? [{ name: "hub", title: "Hub", options: hubs.map(hub => ({ value: String(hub.id), title: hub.name })) }] : [])]}/>}
    {resource.loading || resource.error ? <><LoadFeedback {...resource}/>{!batch && <Link href={farmerUrl(transfers ? "transfers" : "stock")}>Reset stock view</Link>}</>
      : batch ? item ? <StockEditor key={`${item.id}-${item.available}-${item.received}-${item.available_until}`} item={item} user={user} hubs={hubs} close={() => router.push(listUrl)} updated={() => { setFeedback("Stock update saved."); updated(); }}/>
        : <div className="empty-state"><h2>Batch not found</h2><p>This batch is not part of your inventory.</p><Link href={listUrl}>Return to stock</Link></div>
      : data && <><p className="muted small" role="status">{data.count} matching {data.count === 1 ? "batch" : "batches"}</p><RecordTable caption="Farmer stock inventory" headings={["Produce", "Origin", "Available quantity", "Unit", "Unit price (KES)", "Status", "Actions"]}>
        {data.items.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.channel === "hub" ? item.hub_name : item.location}</td><td>{item.available}</td><td>{item.unit}</td><td>{money(item.price)}</td><td>{stockStatus(item)}</td><td><Link className="text-button" href={recordUrl(item.id)} aria-label={`Manage ${item.name}, batch ${item.id}`}>Manage batch <ArrowRight size={15}/></Link></td></tr>)}
        {!data.items.length && <tr><td colSpan={7}>No batches match these filters. Clear filters or add produce.</td></tr>}
      </RecordTable><ListingPagination data={data} label="Stock pages" href={page => { const next = new URLSearchParams(listParams); next.set("page", String(page)); return `/?${next}`; }}/></>}
  </section>;
}

function WorkspaceEnquiries({ user, version, updated }: { user: User; version: number; updated: () => void }) {
  const params = useSearchParams();
  const id = params.get("enquiry");
  const consumer = user.role === "consumer";
  const sent = consumer || params.get("direction") === "sent";
  const query = new URLSearchParams();
  if (id) query.set("id", id);
  else { query.set(sent ? "outgoing" : "incoming", "true"); query.set("page", params.get("page") || "1"); for (const key of ["q", "status"]) if (params.get(key)) query.set(key, params.get(key)!); }
  const resource = useData<DataPage<Enquiry> | Enquiry[]>(`enquiries/?${query}`, version);
  const listParams = new URLSearchParams(params.toString()); listParams.delete("enquiry");
  const data = resource.data && !Array.isArray(resource.data) ? resource.data : undefined;
  const enquiry = Array.isArray(resource.data) ? resource.data[0] : undefined;
  if (!consumer && enquiry && enquiry.farmer !== user.id) listParams.set("direction", "sent");
  return <section className="workspace">
    {id && <Link className="back-link" href={`/?${listParams}`}><ArrowLeft size={16}/> Back to {consumer ? "my enquiries" : sent || enquiry && enquiry.farmer !== user.id ? "sent enquiries" : "buyer enquiries"}</Link>}
    <div className="section-heading"><div><h1 tabIndex={-1}>{id ? "Enquiry details" : consumer ? "My enquiries" : sent ? "Sent enquiries" : "Buyer enquiries"}</h1><p>{id ? "Review enquiry details and responses." : sent ? "Follow enquiries you have sent to farmers." : "Review incoming enquiries and respond to buyers."}</p></div></div>
    {!id && <TableFilters filters={[{ name: "q", title: sent ? "Search farmer or produce" : "Search buyer or produce" }, ...(!consumer ? [{ name: "direction", title: "Enquiry type", allTitle: "Incoming from buyers", options: [{ value: "sent", title: "Sent to farmers" }] }] : []), { name: "status", title: "Status", options: ["pending", "accepted", "declined", "cancelled", "expired"].map(value => ({ value, title: label(value) })) }]}/>}
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : id ? enquiry ? <EnquiryCard enquiry={enquiry} user={user} updated={updated}/> : <div className="empty-state"><h2>Enquiry not found</h2><Link href={`/?${listParams}`}>Return to enquiries</Link></div>
      : data && <><p className="muted small" role="status">{data.count} matching enquiries</p><RecordTable caption={sent ? "Sent enquiries" : "Incoming buyer enquiries"} headings={[sent ? "Farmer" : "Buyer", ...(sent ? ["Farm"] : []), "Produce", "Quantity", "Unit", sent ? "Sent" : "Received", "Status", "Response due", "Actions"]}>
        {data.items.map(enquiry => { const next = new URLSearchParams(listParams); next.set("enquiry", enquiry.id); const items = enquiry.items.length ? enquiry.items : [null]; return items.map((item, index) => <tr key={`${enquiry.id}:${item?.id || "empty"}`}>
          {index === 0 && <><td rowSpan={items.length}>{sent ? enquiry.farmer_name || "Farmer" : enquiry.consumer_name || "Buyer"}</td>{sent && <td rowSpan={items.length}>{enquiry.farm_name || "Not provided"}</td>}</>}
          <th scope="row">{item?.name || "No produce details"}</th><td>{item?.quantity ?? "—"}</td><td>{item?.unit ?? "—"}</td>
          {index === 0 && <><td rowSpan={items.length}>{dateTime(enquiry.created_at)}</td><td rowSpan={items.length}>{label(enquiry.status)}</td><td rowSpan={items.length}>{enquiry.status === "pending" ? dateTime(enquiry.expires_at) : "—"}</td><td rowSpan={items.length}><Link className="text-button" href={`/?${next}`}>{enquiry.status === "pending" && !sent ? "Review & respond" : "View enquiry"} <ArrowRight size={15}/></Link></td></>}
        </tr>); })}
        {!data.items.length && <tr><td colSpan={sent ? 9 : 8}>No enquiries match these filters.</td></tr>}
      </RecordTable><ListingPagination data={data} label="Enquiry pages" href={page => { const next = new URLSearchParams(listParams); next.set("page", String(page)); return `/?${next}`; }}/></>}
  </section>;
}

function requestStatus(need: ProduceRequest) {
  return need.status === "open" && need.deadline < new Date().toLocaleDateString("en-CA") ? "expired" : label(need.status);
}

function FarmerRequests({ user, version, updated }: { user: User; version: number; updated: () => void }) {
  const params = useSearchParams();
  const id = params.get("request");
  const query = new URLSearchParams();
  if (id) query.set("id", id);
  else { query.set("page", params.get("page") || "1"); for (const key of ["q", "status", "category", "offers"]) if (params.get(key)) query.set(key, params.get(key)!); }
  const resource = useData<DataPage<ProduceRequest> | ProduceRequest[]>(`requests/?${query}`, version);
  const listParams = new URLSearchParams(params.toString()); listParams.delete("request"); listParams.delete("stock_page");
  const data = resource.data && !Array.isArray(resource.data) ? resource.data : undefined;
  const need = Array.isArray(resource.data) ? resource.data[0] : undefined;
  return <section className="workspace">
    {id && <Link className="back-link" href={`/?${listParams}`}><ArrowLeft size={16}/> Back to buyer requests</Link>}
    <div className="section-heading"><div><h1 tabIndex={-1}>{id ? "Buyer request details" : "Buyer requests & offers"}</h1><p>{id ? "Check the quantity, unit and deadline before offering." : "Find buyer needs and follow the offers you have sent."}</p></div></div>
    {!id && <TableFilters filters={[{ name: "q", title: "Search requests or location" }, { name: "status", title: "Request status", options: [{ value: "open", title: "Open" }, { value: "expired", title: "Expired" }, { value: "closed", title: "Closed" }] }, { name: "category", title: "Category", options: categoryOptions }, { name: "offers", title: "Offers", options: [{ value: "mine", title: "My submitted offers" }] }]}/>}
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : id ? need ? <FarmerRequestDetail key={need.id} need={need} user={user} version={version} updated={updated}/> : <div className="empty-state"><h2>Request not found</h2><Link href={`/?${listParams}`}>Return to requests</Link></div>
      : data && <><p className="muted small" role="status">{data.count} matching requests</p><RecordTable caption="Buyer requests and farmer offers" headings={["Request", "Buyer", "Quantity", "Unit", "Location", "Deadline", "Status", "My unit price (KES)", "Actions"]}>
        {data.items.map(need => { const next = new URLSearchParams(listParams); next.set("request", String(need.id)); const bid = need.bids.find(bid => bid.is_mine); return <tr key={need.id}><th scope="row">{need.name}</th><td>{need.consumer_name || "Buyer"}</td><td>{need.quantity}</td><td>{need.unit}</td><td>{need.location}</td><td>{need.deadline}</td><td>{requestStatus(need)}</td><td>{bid ? money(bid.price) : "Not submitted"}</td><td><Link className="text-button" href={`/?${next}`}>View request <ArrowRight size={15}/></Link></td></tr>; })}
        {!data.items.length && <tr><td colSpan={9}>No buyer requests match these filters.</td></tr>}
      </RecordTable><ListingPagination data={data} label="Request pages" href={page => { const next = new URLSearchParams(listParams); next.set("page", String(page)); return `/?${next}`; }}/></>}
  </section>;
}

function FarmerRequestDetail({ need, user, version, updated }: { need: ProduceRequest; user: User; version: number; updated: () => void }) {
  const bid = need.bids.find(bid => bid.is_mine);
  const open = need.status === "open" && need.deadline >= new Date().toLocaleDateString("en-CA");
  return <div className="workspace-record"><h2>{need.name}</h2><p>{need.notes}</p><dl className="detail-facts"><div><dt>Buyer</dt><dd>{need.consumer_name || "Buyer"}</dd></div><div><dt>Quantity</dt><dd>{need.quantity} {need.unit}</dd></div><div><dt>Total budget</dt><dd>{money(need.budget)}</dd></div><div><dt>Location</dt><dd>{need.location}</dd></div><div><dt>Deadline</dt><dd>{need.deadline}</dd></div><div><dt>Status</dt><dd>{open ? "Open" : need.status === "open" ? "Expired" : label(need.status)}</dd></div></dl>
    {bid ? <><h3>Your submitted offer</h3><RecordTable caption="Your offer for this request" headings={["Produce", "Unit price (KES)", "Unit", "Message"]}><tr><th scope="row">{bid.listing_name}</th><td>{money(bid.price)}</td><td>{need.unit}</td><td>{bid.message || "No message"}</td></tr></RecordTable></>
      : need.is_owner ? <p className="notice-inline">You cannot offer on your own request.</p> : open ? <FarmerOffer need={need} user={user} version={version} updated={updated}/> : <p className="notice-inline">This request is no longer accepting offers.</p>}
  </div>;
}

function FarmerOffer({ need, version, updated }: { need: ProduceRequest; user: User; version: number; updated: () => void }) {
  const params = useSearchParams();
  const resource = useData<ListingPage>(`listings/?mine=true&offer_request=${need.id}&page=${params.get("stock_page") || "1"}`, version);
  const action = useAction(updated);
  return <><h3 className="workspace-subtitle">Send an offer</h3><ErrorMessage error={action.error}/>
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : resource.data && <>
      {resource.data.items.length ? <ActionForm action={action} className="form-stack workspace-form" onSubmit={event => { event.preventDefault(); const data = fields(event); void action.run(() => api(`requests/${need.id}/bids/`, "POST", data)); }}>
        <Control title="Your available produce"><select name="listing" key={resource.data.page} defaultValue="" required><option value="" disabled>Choose your stock</option>{resource.data.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.hub_name || item.location} · {item.available} {item.unit}</option>)}</select></Control>
        <Control title={`Price per ${need.unit} (KES)`}><input name="price" type="number" step=".01" min=".01" required/></Control>
        <Control title="Message (optional)"><textarea name="message" maxLength={400} rows={3}/></Control>
        <button className="primary-button" disabled={action.busy}>{action.busy ? "Sending offer..." : "Send offer"}</button>
      </ActionForm> : <p className="notice-inline">No active stock covers the full quantity and unit. Add or reconfirm suitable produce before offering.</p>}
      <ListingPagination data={resource.data} label="Eligible stock pages" href={page => { const next = new URLSearchParams(params.toString()); next.set("stock_page", String(page)); return `/?${next}`; }}/>
      {!resource.data.items.length && <Link className="text-button" href={farmerUrl("stock")}>Manage produce & stock <ArrowRight size={15}/></Link>}
    </>}
  </>;
}

type ConsumerWorkspaceProps = {
  user: User; version: number; updated: () => void; notificationVersion: number; notificationUpdated: () => void;
  latestId: number; unreadCount: number; requestForm: ReactNode;
  acceptOffer: (id: number, contact: string, message: string) => Promise<void>;
};

export function ConsumerWorkspace({ user, version, updated, notificationVersion, notificationUpdated, latestId, unreadCount, requestForm, acceptOffer }: ConsumerWorkspaceProps) {
  const params = useSearchParams();
  const legacyView = params.get("view");
  const section = legacyView === "orders" ? "enquiries" : legacyView !== "consumer" ? legacyView || "overview" : params.get("section") || "overview";
  const navigation = [
    { id: "overview", title: "Overview", icon: LayoutGrid },
    { id: "enquiries", title: "My enquiries", icon: Package },
    { id: "requests", title: "My requests & offers", icon: ClipboardList },
    { id: "notifications", title: "Notifications", icon: Bell },
  ];
  return <WorkspaceLayout title="Consumer workspace" section={section === "new" ? "requests" : section} navigation={navigation} url={consumerUrl} unreadCount={unreadCount}>
    {section === "overview" ? <ConsumerOverview version={version}/>
      : section === "enquiries" ? <WorkspaceEnquiries user={user} version={version} updated={updated}/>
      : section === "requests" ? <ConsumerRequests version={version} acceptOffer={acceptOffer}/>
      : section === "notifications" ? <Inbox key={`${user.id}:${params}`} user={user} version={notificationVersion} updated={notificationUpdated} latestId={latestId} unreadCount={unreadCount}/>
      : section === "new" ? <section className="workspace"><Link className="back-link" href={consumerUrl("requests")}><ArrowLeft size={16}/> Back to my requests</Link><div className="section-heading"><h1 tabIndex={-1}>Create a request</h1></div><div className="workspace-form">{requestForm}</div></section>
      : <section className="empty-state"><h1 tabIndex={-1}>Workspace view not found</h1><Link href={consumerUrl()}>Return to overview</Link></section>}
  </WorkspaceLayout>;
}

function ConsumerOverview({ version }: { version: number }) {
  const resource = useData<{ pending_enquiries: number; accepted_enquiries: number; requests_with_offers: number }>("consumer-workspace/", version);
  const tasks = resource.data ? [
    { title: "Enquiries awaiting a farmer reply", count: resource.data.pending_enquiries, href: consumerUrl("enquiries", { status: "pending" }), action: "View enquiries" },
    { title: "Accepted enquiries", count: resource.data.accepted_enquiries, href: consumerUrl("enquiries", { status: "accepted" }), action: "View farmer responses" },
    { title: "Open requests with farmer offers", count: resource.data.requests_with_offers, href: consumerUrl("requests", { status: "open", has_offers: "true" }), action: "Compare offers" },
  ] : [];
  return <section className="workspace"><div className="section-heading"><div><h1 tabIndex={-1}>My workspace</h1><p>Follow your enquiries, compare offers and connect with farmers.</p></div><Link className="primary-button" href={consumerUrl("new")}><Plus size={17}/> Create a request</Link></div>
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : <RecordTable caption="Consumer activity" headings={["Activity", "Records", "Actions"]}>{tasks.map(task => <tr key={task.title}><th scope="row">{task.title}</th><td>{task.count}</td><td><Link className="text-button" href={task.href}>{task.action} <ArrowRight size={15}/></Link></td></tr>)}</RecordTable>}
  </section>;
}

function ConsumerRequests({ version, acceptOffer }: Pick<ConsumerWorkspaceProps, "version" | "acceptOffer">) {
  const params = useSearchParams();
  const id = params.get("request");
  const query = new URLSearchParams({ mine: "true" });
  if (id) query.set("id", id);
  else { query.set("page", params.get("page") || "1"); for (const key of ["q", "status", "category", "has_offers"]) if (params.get(key)) query.set(key, params.get(key)!); }
  const resource = useData<DataPage<ProduceRequest> | ProduceRequest[]>(`requests/?${query}`, version);
  const listParams = new URLSearchParams(params.toString());
  for (const key of ["request", "offer", "offer_q", "offer_sort", "offer_page"]) listParams.delete(key);
  const data = resource.data && !Array.isArray(resource.data) ? resource.data : undefined;
  const need = Array.isArray(resource.data) ? resource.data[0] : undefined;
  const offer = params.get("offer");
  return <section className="workspace">
    {id && <Link className="back-link" href={offer ? (() => { const next = new URLSearchParams(params.toString()); next.delete("offer"); return `/?${next}`; })() : `/?${listParams}`}><ArrowLeft size={16}/> {offer ? "Back to request & offers" : "Back to my requests"}</Link>}
    <div className="section-heading"><div><h1 tabIndex={-1}>{offer ? "Review farmer offer" : id ? "Request details & offers" : "My requests & offers"}</h1>{!id && <p>Manage your requests and compare farmers' offers.</p>}</div>{!id && <Link className="primary-button" href={consumerUrl("new")}><Plus size={17}/> Create a request</Link>}</div>
    {!id && <TableFilters filters={[{ name: "q", title: "Search my requests" }, { name: "status", title: "Request status", options: [{ value: "open", title: "Open" }, { value: "expired", title: "Expired" }, { value: "closed", title: "Closed" }] }, { name: "category", title: "Category", options: categoryOptions }, { name: "has_offers", title: "Farmer offers", options: [{ value: "true", title: "With offers" }] }]}/>}
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : id ? need ? offer ? <ConsumerOfferReview need={need} offerId={offer} acceptOffer={acceptOffer}/> : <ConsumerRequestDetail need={need}/>
      : <div className="empty-state"><h2>Request not found</h2><p>This request is not part of your workspace.</p><Link href={`/?${listParams}`}>Return to my requests</Link></div>
      : data && <><p className="muted small" role="status">{data.count} matching requests</p><RecordTable caption="My produce requests" headings={["Request", "Produce", "Quantity", "Unit", "Budget (KES)", "Location", "Deadline", "Status", "Offers", "Actions"]}>
        {data.items.map(need => { const next = new URLSearchParams(listParams); next.set("request", String(need.id)); return <tr key={need.id}><th scope="row">{need.name}</th><td>{need.product_name || "Not specified"}</td><td>{need.quantity}</td><td>{need.unit}</td><td>{money(need.budget)}</td><td>{need.location}</td><td>{need.deadline}</td><td>{requestStatus(need)}</td><td>{need.bids.length}</td><td><Link className="text-button" href={`/?${next}`}>View request <ArrowRight size={15}/></Link></td></tr>; })}
        {!data.items.length && <tr><td colSpan={10}>No requests match these filters.</td></tr>}
      </RecordTable><ListingPagination data={data} label="My request pages" href={page => { const next = new URLSearchParams(listParams); next.set("page", String(page)); return `/?${next}`; }}/></>}
  </section>;
}

function ConsumerRequestDetail({ need }: { need: ProduceRequest }) {
  const params = useSearchParams();
  const search = (params.get("offer_q") || "").toLowerCase().trim();
  const bids = need.bids.filter(bid => `${bid.farm_name} ${bid.farmer_name} ${bid.listing_name}`.toLowerCase().includes(search));
  const order = params.get("offer_sort");
  if (order === "price_asc" || order === "price_desc") bids.sort((a, b) => (Number(a.price) - Number(b.price)) * (order === "price_desc" ? -1 : 1));
  const page = Number(params.get("offer_page") || "1");
  const pages = Math.max(1, Math.ceil(bids.length / 24));
  const validPage = Number.isSafeInteger(page) && page >= 1 && page <= pages;
  function offerPage(value: number) { const next = new URLSearchParams(params.toString()); next.set("offer_page", String(value)); return `/?${next}`; }
  return <div className="workspace-record"><h2>{need.name}</h2><p>{need.notes}</p>
    <dl className="detail-facts"><div><dt>Produce</dt><dd>{need.product_name || "Not specified"}</dd></div><div><dt>Quantity</dt><dd>{need.quantity}</dd></div><div><dt>Unit</dt><dd>{need.unit}</dd></div><div><dt>Total budget</dt><dd>{money(need.budget)}</dd></div><div><dt>Location</dt><dd>{need.location}</dd></div><div><dt>Deadline</dt><dd>{need.deadline}</dd></div><div><dt>Status</dt><dd>{requestStatus(need)}</dd></div></dl>
    <h3>Farmer offers</h3><TableFilters filters={[{ name: "offer_q", title: "Search farmer or produce" }, { name: "offer_sort", title: "Offer order", allTitle: "As received", options: [{ value: "price_asc", title: "Lowest price first" }, { value: "price_desc", title: "Highest price first" }] }]}/>
    {!validPage ? <div className="error-banner" role="alert">This offer page is unavailable. <Link href={offerPage(1)}>Return to the first page</Link></div> : <><p className="muted small" role="status">{bids.length} matching offers</p><RecordTable caption="Farmer offers for my request" headings={["Farm", "Farmer", "Produce", "Unit price (KES)", "Unit", "Indicative total (KES)", "Actions"]}>
      {bids.slice((page - 1) * 24, page * 24).map(bid => { const next = new URLSearchParams(params.toString()); next.set("offer", String(bid.id)); return <tr key={bid.id}><td>{bid.farm_name || "Not provided"}</td><td>{bid.farmer_name || "Farmer"}</td><th scope="row">{bid.listing_name}</th><td>{money(bid.price)}</td><td>{need.unit}</td><td>{money(Number(bid.price) * Number(need.quantity))}</td><td><Link className="text-button" href={`/?${next}`}>Review offer <ArrowRight size={15}/></Link></td></tr>; })}
      {!bids.length && <tr><td colSpan={7}>No farmer offers match.</td></tr>}
    </RecordTable><ListingPagination label="Farmer offer pages" data={{ count: bids.length, page, pages, previous_page: page > 1 ? page - 1 : null, next_page: page < pages ? page + 1 : null }} href={offerPage}/></>}
    {need.hub_matches.length > 0 && <><h3>Matching hub produce</h3><RecordTable caption="Matching produce at the selected hub" headings={["Produce", "Actions"]}>{need.hub_matches.map(match => <tr key={match.id}><th scope="row">{match.name}</th><td><Link className="text-button" href={`/?view=product&id=${match.id}`}>View produce <ArrowRight size={15}/></Link></td></tr>)}</RecordTable></>}
  </div>;
}

function ConsumerOfferReview({ need, offerId, acceptOffer }: { need: ProduceRequest; offerId: string; acceptOffer: ConsumerWorkspaceProps["acceptOffer"] }) {
  const action = useAction(() => {});
  const bid = need.bids.find(bid => String(bid.id) === offerId);
  if (!bid) return <div className="empty-state"><h2>Offer not found</h2><p>Return to the request to choose an available offer.</p></div>;
  const open = requestStatus(need) === "open";
  return <div className="workspace-record"><h2>{bid.listing_name}</h2><dl className="detail-facts"><div><dt>Farm</dt><dd>{bid.farm_name || "Not provided"}</dd></div><div><dt>Farmer</dt><dd>{bid.farmer_name}</dd></div><div><dt>Quantity</dt><dd>{need.quantity}</dd></div><div><dt>Unit</dt><dd>{need.unit}</dd></div><div><dt>Unit price</dt><dd>{money(bid.price)}</dd></div><div><dt>Indicative total</dt><dd>{money(Number(bid.price) * Number(need.quantity))}</dd></div></dl>
    {bid.message && <p>{bid.message}</p>}<ErrorMessage error={action.error}/>
    {open ? <><p>{connectionNotice}</p><p className="notice-inline">Sending an enquiry checks and deducts stock. It does not make a payment.</p><ActionForm action={action} className="form-stack workspace-form" onSubmit={event => { event.preventDefault(); const data = fields(event); void action.run(() => acceptOffer(bid.id, String(data.contact), String(data.message))); }}>
      <Control title="Your phone number or email"><input name="contact" maxLength={200} required/></Control><Control title="Message (optional)"><textarea name="message" rows={3} maxLength={1000}/></Control>
      <button className="primary-button" disabled={action.busy}>{action.busy ? "Checking stock and sending..." : "Send stock-checked enquiry"}</button>
    </ActionForm></> : <p className="notice-inline">This request is no longer accepting offers.</p>}
  </div>;
}

export function EnquiryReview({ user, items, onSend, signIn }: {
  user: User | null; items: CartItem[]; onSend: (contact: string, message: string) => Promise<void>; signIn: () => void;
}) {
  const action = useAction(() => {});
  const invalidQuantity = items.some(item => !validQuantity(item.listing.unit, item.quantity));
  return <section className="checkout-section"><h2>Connect with the farmer</h2><p>{connectionNotice}</p>
    <p className="muted">We check current stock when you send. Sending deducts the requested quantity from availability; it is not proof of a sale.</p>
    <ErrorMessage error={action.error}/>
    {!user ? <button className="primary-button" onClick={signIn}>Sign in to send an enquiry <ArrowRight size={17}/></button>
      : <ActionForm action={action} className="form-stack" onSubmit={event => {
        event.preventDefault(); const data = fields(event);
        void action.run(() => onSend(String(data.contact), String(data.message)));
      }}>
        <Control title="How the farmer can reach you (required)"><input name="contact" autoComplete="email" required maxLength={200} placeholder="Phone number or email address"/></Control>
        <Control title="Message to the farmer (optional)"><textarea name="message" rows={3} maxLength={1000} placeholder="Introduce yourself and explain what you need."/></Control>
        <p className="muted small">Your contact is shared only with the named farmer. Your private bag has not notified them. Unanswered enquiries expire after 24 hours.</p>
        {invalidQuantity && <p className="field-error" role="alert">Live animals need whole-number quantities. Return to your bag and adjust the quantity before sending.</p>}
        <button className="primary-button" disabled={action.busy || invalidQuantity || items.some(item => item.expiresAt <= Date.now())}>{action.busy ? "Checking stock and sending..." : "Send enquiry"} <ArrowRight size={17}/></button>
      </ActionForm>}
  </section>;
}

export function Enquiries({ user, version, updated, focusId, embedded = false }: { user: User; version: number; updated: () => void; focusId: string | null; embedded?: boolean }) {
  const resource = useData<Enquiry[]>("enquiries/", version);
  useEffect(() => {
    if (resource.data && focusId) document.getElementById(`enquiry-${focusId}`)?.focus();
  }, [resource.data, focusId]);
  const Heading = embedded ? "h2" : "h1";
  return <section className="workspace"><div className="section-heading"><div><Heading>Your enquiries</Heading><p>Real connections. Arrangements made directly.</p></div><button className="secondary-button" onClick={resource.retry}>Refresh enquiries</button></div>
    <p className="notice-inline">{connectionNotice}</p>
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : resource.data?.length
      ? <div className="order-list">{resource.data.map(enquiry => <EnquiryCard key={enquiry.id} enquiry={enquiry} user={user} updated={updated}/>)}</div>
      : <div className="empty-state"><Package size={36}/><h2>No enquiries yet</h2><p>Send an enquiry from your bag, or respond to a buyer request.</p><Link className="primary-button" href="/">Explore produce <ArrowRight size={17}/></Link></div>}
  </section>;
}

function EnquiryCard({ enquiry, user, updated }: { enquiry: Enquiry; user: User; updated: () => void }) {
  const action = useAction(updated);
  const farmer = user.id === enquiry.farmer;
  const [decision, setDecision] = useState("accepted");
  return <article className="order-card enquiry-card" tabIndex={-1} id={`enquiry-${enquiry.id}`}>
    <div className="order-top"><div><h2>{farmer ? enquiry.consumer_name || "Buyer enquiry" : enquiry.farm_name || enquiry.farmer_name || "Farmer enquiry"}</h2><p>{dateTime(enquiry.created_at)}</p></div><span className={`status-pill ${enquiry.status === "accepted" ? "green" : enquiry.status === "pending" ? "warning" : ""}`}>{enquiry.status === "pending" ? "Awaiting farmer" : label(enquiry.status)}</span></div>
    <RecordTable caption="Enquiry produce" headings={["Produce", "Quantity", "Unit", "Origin", "Unit price (KES)", "Indicative total (KES)"]}>{enquiry.items.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.quantity}</td><td>{item.unit}</td><td>{item.location}</td><td>{money(item.price)}</td><td>{money(Number(item.quantity) * Number(item.price))}</td></tr>)}</RecordTable>
    <p className="muted small">Indicative produce total: {money(enquiry.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0))}. No payment collected.</p>
    {enquiry.message && <p className="enquiry-message">{enquiry.message}</p>}
    <p><strong>Buyer contact:</strong> {enquiry.contact}</p>
    {enquiry.status === "pending" && <p className="muted">Farmer response due by {dateTime(enquiry.expires_at)}. This is not a pickup deadline.</p>}
    {enquiry.response && <div className="enquiry-message"><strong>Farmer response</strong><p>{enquiry.response}</p></div>}
    {enquiry.pickup_details && <p className="notice-inline"><MapPin size={18}/>{enquiry.pickup_details}</p>}
    {["declined", "expired", "cancelled"].includes(enquiry.status) && <p className="muted">Stock stays deducted until the farmer or responsible hub manager reconciles it.</p>}
    <ErrorMessage error={action.error}/>
    {farmer && enquiry.status === "pending" && <ActionForm action={action} className="form-stack" onSubmit={event => {
      event.preventDefault(); const data = fields(event);
      void action.run(() => api(`enquiries/${enquiry.id}/reply/`, "POST", data));
    }}>
      <Control title="Response (required)"><textarea name="response" required maxLength={1000} rows={2}/></Control>
      <Control title="Decision"><select name="status" value={decision} onChange={event => setDecision(event.target.value)}><option value="accepted">Accept enquiry</option><option value="declined">Decline enquiry</option></select></Control>
      <Control title="Your contact and farm/hub location (required when accepting)"><textarea name="pickup_details" required={decision === "accepted"} maxLength={500} rows={2} placeholder="Share your contact details and the farm or hub location."/></Control>
      <button className="primary-button" disabled={action.busy}>{action.busy ? "Sending response..." : "Send response"}</button>
    </ActionForm>}
    {!farmer && enquiry.status === "pending" && <button className="text-button" disabled={action.busy} onClick={() => void action.run(() => api(`enquiries/${enquiry.id}/cancel/`, "POST"))}>Cancel enquiry</button>}
  </article>;
}

export function Inbox({ user, version, updated, latestId, unreadCount }: {
  user: User; version: number; updated: () => void; latestId: number; unreadCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const farmer = user.role === "farmer";
  const linkedViews = farmer || user.role === "consumer";
  const recordDestination = (link: string) => farmer ? farmerDestination(link) : user.role === "consumer" ? consumerDestination(link) : link;
  const detailId = linkedViews ? params.get("notification") : null;
  const unreadOnly = params.get("inbox") === "unread";
  const snapshot = params.get("notification_snapshot");
  const cursor = params.get("notification_cursor");
  const query = new URLSearchParams({ owner: String(user.id), unread: String(!detailId && unreadOnly) });
  if (detailId) query.set("id", detailId);
  else {
    if (params.get("inbox_q")) query.set("q", params.get("inbox_q")!);
    if (params.get("kind")) query.set("kind", params.get("kind")!);
  }
  if (snapshot !== null) query.set("snapshot", snapshot);
  if (cursor && !detailId) query.set("cursor", cursor);
  const resource = useData<InboxData>(`notifications/?${query}`, version);
  const action = useAction(updated);
  const [selected, setSelected] = useState<number[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const selectAll = useRef<HTMLInputElement>(null);
  const data = resource.data;
  const pageIds = data?.items.map(item => item.id) ?? [];
  const selectedIds = pageIds.filter(id => selected.includes(id));
  const allSelected = pageIds.length > 0 && selectedIds.length === pageIds.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedIds.length > 0 && !allSelected;
  }, [data, selectedIds.length, allSelected]);
  useEffect(() => {
    if (snapshot === null && resource.data) {
      const next = new URLSearchParams(params.toString());
      next.set("notification_snapshot", String(resource.data.snapshot));
      router.replace(`/?${next}`, { scroll: false });
    }
  }, [snapshot, resource.data, params, router]);
  function inboxUrl(filter: boolean, nextCursor: string | null = null) {
    const next = new URLSearchParams(params.toString());
    if (filter) next.set("inbox", "unread"); else next.delete("inbox");
    if (nextCursor) next.set("notification_cursor", nextCursor); else next.delete("notification_cursor");
    return `/?${next}`;
  }
  function refresh() {
    const next = new URLSearchParams(params.toString());
    next.delete("notification_cursor"); next.delete("notification_snapshot");
    if (next.toString() === params.toString()) resource.retry();
    else router.replace(`/?${next}`, { scroll: false });
  }
  function openNotification(event: { preventDefault: () => void }, item: InboxData["items"][number]) {
    if (item.read_at) return;
    event.preventDefault();
    void action.run(async () => { await api(`notifications/?owner=${user.id}`, "POST", { id: item.id }); router.push(recordDestination(item.link)); });
  }
  function toggleSelection(id: number, checked: boolean) {
    setFeedback("");
    setSelected(current => checked ? [...current, id] : current.filter(value => value !== id));
  }
  const destination = { enquiry: "View enquiry", stock: "View inventory", hub: "View hub update", bag: "View bag", general: "View details" };
  if (detailId) {
    const listParams = new URLSearchParams(params.toString()); listParams.delete("notification");
    const item = data?.items[0];
    return <section className="workspace"><Link className="back-link" href={`/?${listParams}`}><ArrowLeft size={16}/> Back to notifications</Link><div className="section-heading"><h1 tabIndex={-1}>Notification details</h1></div><ErrorMessage error={action.error}/>
      {resource.loading || resource.error ? <LoadFeedback {...resource}/> : item ? <div className="workspace-record"><h2>{item.title}</h2><p className="muted">{dateTime(item.created_at)} · {item.read_at ? "Read" : "Unread"}</p>{item.context && <p>{item.context}</p>}<p>{item.message}</p><Link className="primary-button" href={recordDestination(item.link)} onNavigate={event => openNotification(event, item)}>{destination[item.kind]} <ArrowRight size={16}/></Link></div> : <div className="empty-state"><h2>Notification not found</h2><Link href={`/?${listParams}`}>Return to notifications</Link></div>}
    </section>;
  }
  return <section className="workspace inbox-workspace" aria-labelledby="inbox-heading">
    <div className="section-heading"><div><h1 id="inbox-heading" tabIndex={-1}>Your notifications</h1><p>Enquiries, stock updates, and hub availability.</p></div><button className="text-button" disabled={resource.loading || action.busy} onClick={refresh}>Refresh notifications</button></div>
    <TableFilters filters={[{ name: "inbox_q", title: "Search notifications" }, { name: "kind", title: "Update type", options: ["enquiry", "stock", "hub", "bag", "general"].map(value => ({ value, title: label(value) })) }]}/>
    <div className="inbox-toolbar">
      <nav className="inbox-filters" aria-label="Notification filters">
        <Link href={inboxUrl(false)} scroll={false} aria-current={!unreadOnly ? "page" : undefined}>All updates</Link>
        <Link href={inboxUrl(true)} scroll={false} aria-current={unreadOnly ? "page" : undefined}>Unread <span>{unreadCount}</span></Link>
      </nav>
      <div className="inbox-bulk-actions">
        {selectedIds.length > 0 && <button className="text-button" disabled={action.busy} onClick={() => { setSelected([]); setFeedback(""); }}>Clear selection</button>}
        <button className="secondary-button" disabled={resource.loading || action.busy || !selectedIds.length}
          onClick={() => void action.run(async () => {
            const result = await api<{ updated: number }>(`notifications/?owner=${user.id}`, "POST", { ids: selectedIds });
            setSelected([]);
            setFeedback(result.updated ? `${result.updated} ${result.updated === 1 ? "update marked" : "updates marked"} as read.` : "Selected updates are already read.");
          })}>{action.busy ? "Updating..." : "Mark selected as read"}</button>
      </div>
    </div>
    <ErrorMessage error={action.error}/>
    {feedback && <p className="inbox-feedback" role="status">{feedback}</p>}
    {data && latestId > data.snapshot && <div className="inbox-new-updates" role="status"><span>New updates are available.</span><button className="text-button" onClick={refresh} disabled={action.busy}>Show new updates <ArrowRight size={16}/></button></div>}
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : data && <>
      <p className="muted small inbox-result-count" role="status">{data.items.length ? `Showing ${data.items.length} of ${data.count} ${unreadOnly ? "unread " : ""}updates` : "No updates on this page"}{selectedIds.length > 0 && ` · ${selectedIds.length} selected`}</p>
      {data.items.length ? <div className="inbox-table" tabIndex={0} role="region" aria-label="Notifications table">
        <table>
          <caption className="sr-only">Notifications. Selection applies to this page only. Open a subject to view its linked record, or use Details to read the full update.</caption>
          <thead><tr>
            <th scope="col" className="inbox-select-column"><label className="inbox-checkbox"><input ref={selectAll} type="checkbox" checked={allSelected} disabled={action.busy}
              onChange={event => { setSelected(event.target.checked ? pageIds : []); setFeedback(""); }}/><span className="sr-only">Select all notifications on this page</span></label></th>
            <th scope="col">Subject</th><th scope="col" className="inbox-date-column">Received</th><th scope="col" className="inbox-status-column">Status</th><th scope="col" className="inbox-actions-column">Actions</th>
          </tr></thead>
          <tbody>{data.items.map(item => <Fragment key={item.id}>
            <tr className={`inbox-record ${item.read_at ? "" : "unread"} ${selectedIds.includes(item.id) ? "selected" : ""}`}>
              <td className="inbox-select-column"><label className="inbox-checkbox"><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={action.busy}
                onChange={event => toggleSelection(item.id, event.target.checked)}/><span className="sr-only">Select notification {item.id}: {item.title}</span></label></td>
              <th scope="row"><Link href={recordDestination(item.link)} className="inbox-subject" title={item.title} onNavigate={event => openNotification(event, item)}><span>{item.title}</span></Link>{!linkedViews && <span className="inbox-mobile-status">{item.read_at ? "Read" : "Unread"}</span>}</th>
              <td className="inbox-date-column"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}<small>{new Date(item.created_at).toLocaleTimeString("en-KE", { timeStyle: "short" })}</small></time></td>
              <td className="inbox-status-column"><span className={!item.read_at ? "inbox-status-unread" : "muted"}>{item.read_at ? "Read" : "Unread"}</span></td>
              <td className="inbox-actions-column">{linkedViews ? <Link className="text-button" aria-label={`Details for notification ${item.id}: ${item.title}`} href={(() => { const next = new URLSearchParams(params.toString()); next.set("notification", String(item.id)); return `/?${next}`; })()}>Details</Link> : <button className="text-button" aria-label={`Details for notification ${item.id}: ${item.title}`} aria-expanded={expandedId === item.id} aria-controls={`notification-details-${item.id}`}
                onClick={() => setExpandedId(current => current === item.id ? null : item.id)}>{expandedId === item.id ? "Hide" : "Details"}</button>}</td>
            </tr>
            {expandedId === item.id && <tr id={`notification-details-${item.id}`} className="inbox-detail-row"><td colSpan={5}>
              <div className="inbox-detail-content"><h2>{item.title}</h2><p className="muted small"><time dateTime={item.created_at}>{dateTime(item.created_at)}</time> · {item.read_at ? "Read" : "Unread"}</p>
                {item.context && <p className="inbox-detail-context">{item.context}</p>}<p>{item.message}</p>
                <Link href={item.link} className="text-button" onNavigate={event => openNotification(event, item)}>{destination[item.kind]} <ArrowRight size={15}/></Link>
              </div>
            </td></tr>}
          </Fragment>)}</tbody>
        </table>
      </div> : <div className="empty-state"><Bell size={32} aria-hidden="true"/><h2>{unreadOnly ? "No unread updates" : "No updates here yet"}</h2><p>{unreadOnly ? "You're caught up. Read updates are still in All updates." : "Your enquiries, stock and hub updates will appear here."}</p>{unreadOnly && <Link className="text-button" href={inboxUrl(false)} scroll={false}>See all updates <ArrowRight size={16}/></Link>}</div>}
      <nav className="inbox-pagination" aria-label="Notification pages">
        {data.previous_cursor ? <Link className="secondary-button" href={inboxUrl(unreadOnly, data.previous_cursor)} scroll={false}>Newer updates</Link> : <span className="muted">Newest page</span>}
        {data.next_cursor ? <Link className="secondary-button" href={inboxUrl(unreadOnly, data.next_cursor)} scroll={false}>Older updates <ArrowRight size={16}/></Link> : <span className="muted">No older updates</span>}
      </nav>
    </>}
  </section>;
}

export function Inventory({ user, hubs, version, updated, addProduce, hubMode = false }: {
  user: User; hubs: Hub[]; version: number; updated: () => void; addProduce: () => void; hubMode?: boolean;
}) {
  const params = useSearchParams();
  const page = params.get("inventory_page") || "1";
  const resource = useData<ListingPage>(hubMode ? `hub-drops/?page=${page}` : `listings/?mine=true&page=${page}`, version);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page && !resource.loading) {
      setSelected(null);
      document.getElementById("inventory-heading")?.focus();
      previousPage.current = page;
    }
  }, [page, resource.loading]);
  function inventoryUrl(value: number) {
    const next = new URLSearchParams(params.toString());
    next.set("inventory_page", String(value));
    return `/?${next}`;
  }
  function closeEditor(id: number) {
    setSelected(null);
    requestAnimationFrame(() => { const button = document.getElementById(`manage-batch-${id}`); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "center", behavior: "instant" }); });
  }
  return <section className="workspace"><div className="section-heading"><div><h1 id="inventory-heading" tabIndex={-1}>{hubMode ? "Your hub inventory" : user.farm_name || "Your farm, connected."}</h1><p>{hubMode ? "Record actual receipt and keep physical balances accurate." : "Manage farm stock and follow your produce at aggregation hubs."}</p></div>{!hubMode && <button className="primary-button" onClick={addProduce}>Add produce</button>}</div>
    <p className="notice-inline">Enquiries deduct availability immediately. Declines and expiry do not restore it. Reconcile only the quantity genuinely available for new enquiries, excluding commitments.</p>
    {feedback && <p role="status" className="inbox-feedback">{feedback}</p>}
    {resource.error && page !== "1" && <Link className="text-button" href={inventoryUrl(1)}>Return to the first inventory page</Link>}
    {resource.loading || resource.error ? <LoadFeedback {...resource}/> : resource.data?.items.length ? <>
      {!hubMode && <h2 className="workspace-subtitle">Farm stock and my hub stock</h2>}
      <div className="inventory-table" tabIndex={0} role="region" aria-label="Scrollable stock inventory"><table><caption className="sr-only">Stock by farm or hub batch</caption><thead><tr><th scope="col">Produce</th><th scope="col">Origin</th><th scope="col">Available quantity</th><th scope="col">Unit</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>
        {resource.data.items.map(item => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.channel === "hub" ? item.hub_name : item.location}</td><td>{item.available}</td><td>{item.unit}</td><td>{item.state === "archived" || new Date(item.available_until).getTime() <= Date.now() ? "Expired / archived" : item.channel === "hub" && !item.received ? "In transit" : "Active"}</td><td><button id={`manage-batch-${item.id}`} className="text-button" aria-expanded={selected === item.id} aria-controls={`stock-editor-${item.id}`} onClick={() => { setFeedback(""); setSelected(selected === item.id ? null : item.id); }}>Manage batch</button></td></tr>)}
      </tbody></table></div>
      {resource.data.items.filter(item => item.id === selected).map(item => <StockEditor key={`${item.id}-${item.available}-${item.received}-${item.available_until}`} item={item} user={user} hubs={hubs} close={() => closeEditor(item.id)} updated={() => { setFeedback("Stock update saved."); updated(); }}/>)}
      <ListingPagination data={resource.data} label="Inventory pages" href={inventoryUrl}/>
    </> : <div className="empty-state"><Store size={36}/><h2>No stock entries yet</h2><p>{hubMode ? "Farmer dispatches to your hubs will appear here." : "List farm stock first, then transfer a quantity to a hub without duplicating it."}</p></div>}
    {!hubMode && <Enquiries user={user} version={version} updated={updated} focusId={null} embedded/>}
  </section>;
}

function StockEditor({ item, user, hubs, updated, close }: { item: Listing; user: User; hubs: Hub[]; updated: () => void; close: () => void }) {
  const action = useAction(updated);
  const [mode, setMode] = useState<"stock" | "transfer">("stock");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyKind, setHistoryKind] = useState("");
  const movements = item.movements.filter(movement => (!historyKind || movement.kind === historyKind) && `${movement.note} ${label(movement.kind)}`.toLowerCase().includes(historyQuery.toLowerCase().trim()));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, []);
  const editable = item.channel === "direct" || user.role === "manager";
  const deadline = new Date(Date.now() + 86400000);
  const localDeadline = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return <section className="stock-editor" id={`stock-editor-${item.id}`} aria-labelledby={`stock-heading-${item.id}`}><button className="text-button" onClick={close}>Back to batch</button><h2 ref={heading} id={`stock-heading-${item.id}`} tabIndex={-1}>{item.name} · {item.hub_name || item.location}</h2>
    {item.channel === "hub" && <p>Sent: {item.dispatched_quantity} {item.unit} · Accepted receipt: {item.received_quantity} {item.unit} · Not accepted: {Number(item.dispatched_quantity) - Number(item.received_quantity)} {item.unit}{!item.received && " (receipt not yet confirmed)"}</p>}
    <ErrorMessage error={action.error}/>
    {editable && item.channel === "hub" && !item.received ? <ActionForm action={action} className="form-stack" onSubmit={event => {
      event.preventDefault(); const data = fields(event); void action.run(() => api(`hub-drops/${item.id}/receive/`, "POST", data));
    }}><Control title={`Actual quantity accepted (${item.unit}, required)`}><input name="quantity" type="number" step={quantityStep(item.unit)} min="0" max={item.dispatched_quantity} required/></Control><Control title="Receipt notes / discrepancies (required)"><textarea name="note" maxLength={200} required rows={2}/></Control><p className="muted">The remainder is recorded as not accepted. Rejected goods are not automatically returned to farm availability.</p><button className="primary-button" disabled={action.busy}>Confirm actual receipt</button></ActionForm>
      : editable && <>
        {item.channel === "direct" && <div className="notification-actions"><button className="text-button" aria-pressed={mode === "stock"} onClick={() => { action.reset(); setMode("stock"); }}>Reconcile stock</button><button className="text-button" aria-pressed={mode === "transfer"} onClick={() => { action.reset(); setMode("transfer"); }}>Dispatch to hub</button></div>}
        {mode === "stock" ? <ActionForm action={action} key="stock" className="form-stack" onSubmit={event => {
          event.preventDefault(); const data = fields(event);
          void action.run(() => api(`listings/${item.id}/stock/`, "POST", { ...data, available_until: new Date(String(data.available_until)).toISOString() }));
        }}>
          <Control title={`Current uncommitted quantity (${item.unit}, required)`}><input name="quantity" type="number" min="0" step={quantityStep(item.unit)} defaultValue={item.quantity} required/></Control>
          <Control title="Listing state"><select name="state" defaultValue={item.state}><option value="active">Active / relist after checking stock</option><option value="archived">Withdraw / archive</option></select></Control>
          <Control title="Available until (required)"><input name="available_until" type="datetime-local" defaultValue={localDeadline} required/></Control>
          <Control title="Adjustment type"><select name="kind"><option value="reconcile">Stock check / reconfirmation</option><option value="offline_sale">Offline sale</option><option value="spoiled">Spoilage</option><option value="returned">Removed / returned to farmer</option></select></Control>
          <Control title="Reason for stock update (required)"><textarea name="reason" maxLength={500} rows={2} required/></Control>
          <p className="muted small">Exclude stock already promised to buyers. Returns are not automatically relisted at the farm.</p>
          <button className="primary-button" disabled={action.busy}>{action.busy ? "Saving..." : "Confirm stock update"}</button>
        </ActionForm> : <ActionForm action={action} key="transfer" className="form-stack" onSubmit={event => {
          event.preventDefault(); const data = fields(event); void action.run(() => api(`listings/${item.id}/dispatch/`, "POST", data));
        }}><Control title={`Quantity to dispatch (${item.unit}, required)`}><input name="quantity" type="number" min={quantityStep(item.unit)} max={item.available} step={quantityStep(item.unit)} required/></Control><Control title="Destination hub"><select name="hub" required>{hubs.map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></Control><p className="muted">Dispatch immediately removes farm availability. Hub stock becomes available only after actual receipt confirmation.</p><button className="primary-button" disabled={action.busy || !hubs.length}>Record dispatch</button></ActionForm>}
      </>}
    {!editable && <p className="notice-inline">The hub manager maintains this physical balance. Contact the hub about discrepancies; your movement history is below.</p>}
    <h3 className="workspace-subtitle">Recent stock movements</h3>
    <div className="workspace-filters"><Control title="Search recent movements"><input type="search" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)}/></Control><Control title="Movement type"><select value={historyKind} onChange={event => setHistoryKind(event.target.value)}><option value="">All</option>{[...new Set(item.movements.map(movement => movement.kind))].map(kind => <option value={kind} key={kind}>{label(kind)}</option>)}</select></Control></div>
    <RecordTable caption="Recent stock movements" headings={["Movement", "Change", "Balance", "Unit", "Reason", "Recorded"]}>{movements.map(movement => <tr key={movement.id}><th scope="row">{label(movement.kind)}</th><td>{movement.change}</td><td>{movement.balance}</td><td>{item.unit}</td><td>{movement.note}</td><td>{dateTime(movement.created_at)}</td></tr>)}{!movements.length && <tr><td colSpan={6}>No recent movements match.</td></tr>}</RecordTable>
  </section>;
}
