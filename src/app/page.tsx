"use client";

import { cloneElement, createContext, Fragment, isValidElement, Suspense, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownUp, ArrowLeft, ArrowRight, Carrot, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Egg, Heart, LayoutGrid, Leaf, LoaderCircle, MapPin,
  Milk, Minus, Package, Plus, Search, ShieldCheck, ShoppingBag, SlidersHorizontal,
  Sprout, Store, Tractor, Truck, Users, Wheat, X,
} from "lucide-react";
import { api, ApiError, label, money, type CartItem, type Hub, type Listing, type Order, type ProduceRequest, type User } from "@/lib/api";
import { groupBag, restoreBag } from "@/lib/bag";
import { responsiveImage } from "@/lib/images";

const views = ["market", "requests", "hubs", "orders", "saved", "farm", "manage", "product", "cart", "checkout"] as const;
type View = typeof views[number];
type Panel = "login" | "register" | "request" | "listing" | "location" | "help" | "filters" | null;
const isView = (value: string | null): value is View => views.some((view) => view === value);
function routeUrl(view: View, params: Record<string, string> = {}) {
  const values = new URLSearchParams(params);
  for (const [key, value] of [...values]) if (!value) values.delete(key);
  if (view !== "market") values.set("view", view);
  return values.size ? `/?${values}` : "/";
}
const categories = [
  { id: "", name: "All produce", icon: LayoutGrid },
  { id: "vegetables", name: "Vegetables", icon: Carrot },
  { id: "fruits", name: "Fruits", icon: Leaf },
  { id: "dairy", name: "Dairy & eggs", icon: Egg },
  { id: "grains", name: "Grains & pulses", icon: Wheat },
  { id: "livestock", name: "Livestock", icon: Tractor },
  { id: "byproducts", name: "Byproducts", icon: Milk },
];
const areas = [
  { id: "kilimani", name: "Kilimani, Nairobi", lat: -1.292, lng: 36.783 },
  { id: "karen", name: "Karen, Nairobi", lat: -1.319, lng: 36.708 },
  { id: "limuru", name: "Limuru, Kiambu", lat: -1.16, lng: 36.65 },
];
const today = () => new Date().toLocaleDateString("en-CA");
const formValues = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget).entries());
type LoadState = { status: "loading" | "ready" | "error"; error: string };
const initialLoad: LoadState = { status: "loading", error: "" };
const filterKeys = ["category", "channel", "hub", "sort", "max_price", "radius"] as const;
const emptyFilters = Object.fromEntries(filterKeys.map((key) => [key, ""]));
const FeedbackContext = createContext<{ error: string; notice: string; fields: Record<string, string>; form: HTMLFormElement | null }>({ error: "", notice: "", fields: {}, form: null });

function Field({ title, children }: { title: string; children: ReactNode }) {
  const { fields, form } = useContext(FeedbackContext);
  const field = useRef<HTMLLabelElement>(null);
  const id = useId();
  const control = isValidElement<{ name?: string; required?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string }>(children) ? children : null;
  const error = control?.props.name && form === field.current?.closest("form") ? fields[control.props.name] : "";
  return <label ref={field} className="field"><span>{title}{control?.props.required && <span className="required-note"> (required)</span>}</span>{control ? cloneElement(control, { "aria-invalid": error ? true : undefined, "aria-describedby": error ? id : undefined }) : children}{error && <small id={id} className="field-error">{error}</small>}</label>;
}

function Drawer({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const feedback = useContext(FeedbackContext);
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous; node?.close();
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        const target = opener?.isConnected && opener.getClientRects().length ? opener : document.querySelector<HTMLElement>(".account-menu summary");
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialog} className="drawer" onCancel={close} onClick={(event) => { if (event.target === event.currentTarget) close(); }} aria-labelledby="drawer-title">
    <header className="drawer-header"><h2 id="drawer-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close panel"><X size={21}/></button></header>
    <div className="drawer-body">{feedback.error && <div className="error-banner" role="alert">{feedback.error}</div>}{feedback.notice && <div className="notice-inline" role="status"><CheckCircle2 size={17}/>{feedback.notice}</div>}{children}</div>
  </dialog>;
}

export default function Home() {
  return <Suspense fallback={<div className="loading-state"><LoaderCircle className="spinner"/> Opening your market…</div>}><Marketplace/></Suspense>;
}

function Marketplace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const view: View = isView(requestedView) ? requestedView : "market";
  const productId = Number(searchParams.get("id"));
  const query = searchParams.get("q") || "";
  const requestQuery = searchParams.get("requests_q") || "";
  const hubQuery = searchParams.get("hubs_q") || "";
  const searchScope = view === "requests" || view === "hubs" ? view : "market";
  const searchKey = searchScope === "market" ? "q" : `${searchScope}_q`;
  const activeQuery = searchScope === "requests" ? requestQuery : searchScope === "hubs" ? hubQuery : query;
  const [searchDraft, setSearchDraft] = useState(activeQuery);
  useEffect(() => setSearchDraft(activeQuery), [activeQuery, searchScope]);
  const searchPlaceholder = searchScope === "requests" ? "Search buyer requests" : searchScope === "hubs" ? "Search hubs or locations" : "Search produce, farms or locations";
  function viewUrl(next: View, params: Record<string, string> = {}) {
    return routeUrl(next, { q: query, requests_q: requestQuery, hubs_q: hubQuery, ...Object.fromEntries(filterKeys.map((key) => [key, searchParams.get(key) || ""])), area: searchParams.get("area") || "", ...params });
  }
  const setView = (next: View, params: Record<string, string> = {}) => router.push(viewUrl(next, params));
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Listing[]>([]);
  const [catalog, setCatalog] = useState<Listing[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [hubResults, setHubResults] = useState<Hub[]>([]);
  const [requests, setRequests] = useState<ProduceRequest[]>([]);
  const [searchStatus, setSearchStatus] = useState<"loading" | "ready" | "error">("loading");
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<Listing[]>([]);
  const [drops, setDrops] = useState<Listing[]>([]);
  const [resources, setResources] = useState<Record<"session" | "hubs" | "products" | "orders" | "inventory" | "drops", LoadState>>({ session: initialLoad, hubs: initialLoad, products: initialLoad, orders: initialLoad, inventory: initialLoad, drops: initialLoad });
  const updateResource = useCallback((key: keyof typeof resources, status: LoadState["status"], error = "") => setResources((current) => ({ ...current, [key]: { status, error } })), []);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [bagReady, setBagReady] = useState(false);
  const [saved, setSaved] = useState<number[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const detail = catalog.find((item) => item.id === productId);
  const [detailQuantity, setDetailQuantity] = useState("1");
  const category = searchParams.get("category") || "";
  const channel = searchParams.get("channel") || "";
  const hub = searchParams.get("hub") || "";
  const sort = searchParams.get("sort") || "recent";
  const maxPrice = searchParams.get("max_price") || "";
  const radius = searchParams.get("radius") || "";
  const setFilter = (key: string, value: string) => router.replace(viewUrl(view, { [key]: value }), { scroll: false });
  const [gpsPlace, setPlace] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const place = areas.find((area) => area.id === searchParams.get("area")) || gpsPlace;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationForm, setValidationForm] = useState<HTMLFormElement | null>(null);
  const submittedForm = useRef<HTMLFormElement | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [listingChannel, setListingChannel] = useState("direct");
  const [activeBid, setActiveBid] = useState<number | null>(null);
  const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
  const checkoutKey = useRef<string>(crypto.randomUUID());
  const awardKey = useRef(crypto.randomUUID());
  const storageProblem = useRef(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const pageHeading = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const resumePanel = useRef<Panel>(null);

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    let active = true;
    updateResource("session", "loading");
    api<{ user: User | null }>("session/").then((session) => { if (active) { setUser(session.user); updateResource("session", "ready"); } })
      .catch((cause: Error) => { if (active) updateResource("session", "error", cause.message); });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((cause: Error) => console.error("Offline shell registration failed:", cause));
    }
    return () => { active = false; };
  }, [sessionRefresh, updateResource]);
  useEffect(() => {
    let active = true;
    updateResource("hubs", "loading");
    api<Hub[]>("hubs/").then((locations) => { if (active) { setHubs(locations); updateResource("hubs", "ready"); } })
      .catch((cause: Error) => { if (active) updateResource("hubs", "error", cause.message); });
    return () => { active = false; };
  }, [refresh, updateResource]);
  useEffect(() => { setError(""); setFieldErrors({}); setValidationForm(null); }, [panel, activeBid, trackingOrder?.id]);
  useEffect(() => {
    let active = true;
    setCatalogStatus("loading");
    setCatalogError("");
    api<Listing[]>("listings/").then((data) => {
      if (active) { setCatalog(data); setCatalogStatus("ready"); }
    }).catch((cause: Error) => { if (active) { setCatalogError(cause.message); setCatalogStatus("error"); } });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (catalogStatus !== "ready" || bagReady) return;
    try {
      const restored = restoreBag(localStorage.getItem("sokosoo-bag-v1"), catalog);
      setCart(restored.items);
      const key = localStorage.getItem("sokosoo-checkout-key-v1");
      if (key && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) checkoutKey.current = key;
      if (restored.adjusted) notify("Your bag was updated to current stock. Unavailable produce was removed.");
    } catch (cause) {
      console.error("Bag restoration failed:", cause);
      setError("Your saved bag could not be restored. Please add your produce again.");
    }
    setBagReady(true);
  }, [catalog, catalogStatus, bagReady, notify]);
  useEffect(() => {
    if (!bagReady) return;
    try {
      localStorage.setItem("sokosoo-bag-v1", JSON.stringify(cart.map((item) => ({ listingId: item.listing.id, quantity: item.quantity }))));
      localStorage.setItem("sokosoo-checkout-key-v1", checkoutKey.current);
    } catch (cause) {
      console.error("Bag persistence failed:", cause);
      if (!storageProblem.current) { storageProblem.current = true; setError("This browser cannot save your bag. Keep this tab open until you finish checkout."); }
    }
  }, [cart, bagReady]);
  useEffect(() => {
    accountMenu.current?.removeAttribute("open");
    setPanel(null);
    setDetailQuantity("1");
    if (previousView.current !== view) {
      setError("");
      pageHeading.current?.focus({ preventScroll: true });
      previousView.current = view;
    }
  }, [view, productId]);
  useEffect(() => {
    const closeAccount = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenu.current?.contains(event.target)) accountMenu.current?.removeAttribute("open");
    };
    const escapeAccount = (event: KeyboardEvent) => {
      if (event.key === "Escape" && accountMenu.current?.open) {
        accountMenu.current.removeAttribute("open");
        accountMenu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeAccount);
    document.addEventListener("keydown", escapeAccount);
    return () => { document.removeEventListener("pointerdown", closeAccount); document.removeEventListener("keydown", escapeAccount); };
  }, []);
  useEffect(() => {
    if (view !== "market" && view !== "saved") return;
    let active = true;
    if (!query && !category && !channel && !hub && sort === "recent" && !place) {
      setLoading(catalogStatus === "loading");
      setProducts(catalog);
      updateResource("products", catalogStatus, catalogError);
      return;
    }
    updateResource("products", "loading");
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, category, channel, hub, sort });
      if (place) { params.set("lat", String(place.lat)); params.set("lng", String(place.lng)); if (radius) params.set("radius", radius); }
      api<Listing[]>(`listings/?${params}`).then((data) => { if (active) { setProducts(data); updateResource("products", "ready"); } })
        .catch((cause: Error) => { if (active) { setProducts([]); updateResource("products", "error", cause.message); } })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [view, query, category, channel, hub, sort, place, radius, refresh, catalog, catalogStatus, catalogError, updateResource]);
  useEffect(() => {
    if (view !== "requests" && view !== "hubs") return;
    let active = true;
    setSearchStatus("loading");
    setError("");
    if (view === "hubs" && !hubQuery) {
      setHubResults(hubs);
      setSearchStatus(resources.hubs.status);
      if (resources.hubs.error) setError(resources.hubs.error);
      return;
    }
    const params = new URLSearchParams({ q: view === "requests" ? requestQuery : hubQuery });
    const load = async () => {
      try {
        if (view === "requests") {
          const data = await api<ProduceRequest[]>(`requests/?${params}`);
          if (active) setRequests(data);
        } else {
          const data = await api<Hub[]>(`hubs/?${params}`);
          if (active) setHubResults(data);
        }
        if (active) setSearchStatus("ready");
      } catch (cause) {
        if (active) {
          setSearchStatus("error");
          setError(cause instanceof Error ? cause.message : "Could not load search results.");
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [view, requestQuery, hubQuery, user?.id, user?.role, refresh, hubs, resources.hubs]);
  useEffect(() => {
    let active = true;
    const load = async <T,>(key: "orders" | "inventory" | "drops", path: string, commit: (data: T) => void) => {
      updateResource(key, "loading");
      try {
        const data = await api<T>(path);
        if (active) { commit(data); updateResource(key, "ready"); }
      } catch (cause) { if (active) updateResource(key, "error", cause instanceof Error ? cause.message : "Could not load this workspace."); }
    };
    if (user && (view === "orders" || view === "farm")) void load("orders", "orders/", setOrders);
    if (user?.role === "farmer" && (view === "farm" || view === "requests")) void load("inventory", "listings/?mine=true", setInventory);
    if (user?.role === "manager" && view === "manage") void load("drops", "hub-drops/", setDrops);
    return () => { active = false; };
  }, [view, user?.id, user?.role, refresh, updateResource]);
  useEffect(() => {
    if (!trackingOrder) return;
    const timer = setInterval(() => {
      api<Order>(`orders/${trackingOrder.id}/tracking/`).then(setTrackingOrder)
        .catch((cause: Error) => setError(cause.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [trackingOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function navigate(next: View) {
    setView(next); accountMenu.current?.removeAttribute("open"); setError("");
  }
  async function action(run: () => Promise<void>) {
    if (busy) return;
    const form = submittedForm.current;
    submittedForm.current = null;
    setBusy(true); setError(""); setFieldErrors({});
    try { await run(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
      if (cause instanceof ApiError && form?.isConnected) {
        setValidationForm(form);
        setFieldErrors(cause.fields);
        requestAnimationFrame(() => {
          const first = Object.keys(cause.fields).map((key) => form.elements.namedItem(key)).find((element) => element instanceof HTMLElement);
          if (first instanceof HTMLElement) first.focus();
        });
      }
    }
    finally { setBusy(false); }
  }
  function addToCart(listing: Listing, quantity = 1) {
    if (busy) { setError("Please wait for the current action to finish before changing your bag."); return; }
    if (!bagReady) { setError("Please wait for your bag to load before adding produce."); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { setError("Enter a quantity greater than zero."); return; }
    const current = cart.find((item) => item.listing.id === listing.id)?.quantity || 0;
    const next = Math.round((current + quantity) * 100) / 100;
    if (next > Number(listing.available)) { setError(`Only ${listing.available} ${listing.unit} is available, including what's already in your bag.`); return; }
    setCart((items) => items.some((item) => item.listing.id === listing.id)
      ? items.map((item) => item.listing.id === listing.id ? { listing, quantity: next } : item)
      : [...items, { listing, quantity }]);
    checkoutKey.current = crypto.randomUUID();
    notify(`${listing.name} added to your bag`);
  }
  function updateQuantity(id: number, change: number) {
    if (busy) { setError("Please wait for the current action to finish before changing your bag."); return; }
    setCart((items) => items.map((item) => item.listing.id === id ? { ...item, quantity: Math.max(0, Math.min(Number(item.listing.available), Math.round((item.quantity + change) * 100) / 100)) } : item).filter((item) => item.quantity > 0));
    checkoutKey.current = crypto.randomUUID();
  }
  function needLogin(next: Panel) {
    if (!user) resumePanel.current = next;
    setPanel(user ? next : "login");
  }
  const total = cart.reduce((sum, item) => sum + Number(item.listing.price) * item.quantity, 0);
  const count = cart.length;
  const cartGroups = groupBag(cart);
  const requestedOrigin = searchParams.get("origin");
  const checkoutGroup = requestedOrigin ? cartGroups.find((group) => group.key === requestedOrigin) : cartGroups.length === 1 ? cartGroups[0] : undefined;
  const workspace = view === "farm" || view === "manage";
  const shown = products.filter((item) => (!maxPrice || Number(item.price) <= Number(maxPrice)) && (view !== "saved" || saved.includes(item.id)));
  const groupByFarmer = Boolean(hub || channel === "hub");
  const displayProducts = groupByFarmer ? [...shown].sort((a, b) => a.farmer - b.farmer) : shown;
  const title = view === "saved" ? "Your saved finds" : query ? `Search results for “${query}”` : category ? categories.find((item) => item.id === category)?.name : hub ? hubs.find((item) => String(item.id) === hub)?.name : "Fresh from the farm";
  const showHero = view === "market" && !query && !category && !hub && !channel;
  const CatalogHeading = showHero ? "h2" : "h1";
  const nav = [{ id: "market" as const, label: "Shop produce" }, { id: "hubs" as const, label: "Shop by hub" }, { id: "requests" as const, label: "Requests & offers" }];
  const farmers = [...new Map(catalog.map((item) => [item.farmer, item])).values()];
  const collapseAccount = () => accountMenu.current?.removeAttribute("open");
  const searchSummary = <div className="active-filters">
    <span role="status">{searchStatus === "loading" ? "Searching…" : searchStatus === "error" ? "Search results unavailable." : `${view === "requests" ? requests.length : hubResults.length} ${view === "requests" ? (requests.length === 1 ? "request" : "requests") : (hubResults.length === 1 ? "hub" : "hubs")}${activeQuery ? ` matching “${activeQuery}”` : ""}`}{view === "requests" && searchStatus === "ready" && requests.length === 100 ? " (showing up to 100; refine your search)" : ""}</span>
    {activeQuery && <button className="text-button" onClick={() => setView(searchScope, { [searchKey]: "" })}>Clear search <X size={14}/></button>}
  </div>;
  const searchFeedback = searchStatus === "loading"
    ? <div className="loading-state"><LoaderCircle className="spinner"/> Finding {view === "requests" ? "buyer requests" : "hubs"}…</div>
    : <div className="empty-state"><CircleHelp size={35}/><h2>Search results could not be loaded</h2><p>Please try again.</p><button className="secondary-button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>Retry search</button></div>;
  const filters = <div className="shopping-filters">
    <Field title="Listing type"><select value={channel} onChange={(event) => setFilter("channel", event.target.value)}><option value="">All listing types</option><option value="direct">Direct from farm</option><option value="hub">From a hub</option></select></Field>
    <Field title="Aggregation hub"><select value={hub} disabled={resources.hubs.status !== "ready"} onChange={(event) => setFilter("hub", event.target.value)}><option value="">All hubs</option>{hubs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    {resources.hubs.status !== "ready" && <ResourceFeedback name="hubs" state={resources.hubs} retry={() => setRefresh((value) => value + 1)}/>}
    <Field title="Maximum unit price"><select value={maxPrice} onChange={(event) => setFilter("max_price", event.target.value)}><option value="">Any price</option><option value="100">Up to KSh 100</option><option value="200">Up to KSh 200</option><option value="500">Up to KSh 500</option></select></Field>
    {place ? <Field title="Distance"><select value={radius} onChange={(event) => setFilter("radius", event.target.value)}><option value="">Any distance</option><option value="5">Within 5 km</option><option value="20">Within 20 km</option><option value="50">Within 50 km</option></select></Field> : <button className="text-button" onClick={() => setPanel("location")}><MapPin size={16}/> Choose location for distance filters</button>}
  </div>;

  return <FeedbackContext.Provider value={{ error, notice, fields: fieldErrors, form: validationForm }}><div className="app-shell" onSubmitCapture={(event) => { if (event.target instanceof HTMLFormElement) submittedForm.current = event.target; }} onChangeCapture={(event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
      const name = event.target.name;
      if (fieldErrors[name]) setFieldErrors((current) => { const next = { ...current }; delete next[name]; return next; });
    }
  }}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="store-header">
      <div className="utility-bar"><div><span>Good food. Fair connections.</span><button onClick={() => user?.role === "farmer" ? navigate("farm") : setPanel("register")}><Tractor size={15}/>{user?.role === "farmer" ? "Farmer workspace" : "Sell on SokoSoo"}</button><button onClick={() => setPanel("help")}>Help & support</button></div></div>
      <div className="retail-topbar">
        <Link className="brand" href="/" aria-label="SokoSoo home"><span className="brand-mark"><Sprout size={25}/></span>Soko<span>Soo</span><span className="brand-dot">.</span></Link>
        <form className="header-search search-field" role="search" aria-label={searchPlaceholder} onSubmit={(event) => { event.preventDefault(); router.push(viewUrl(searchScope, { [searchKey]: searchDraft.trim() }), { scroll: false }); }}>
          <Search size={20}/><input name="search" aria-label={searchPlaceholder} type="search" enterKeyHint="search" placeholder={searchPlaceholder} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}/><button type="submit" aria-label="Search"><ArrowRight size={19}/></button>
        </form>
        <button className="delivery-location" onClick={() => setPanel("location")}><MapPin size={20}/><span><small>Shopping near</small><strong>{place?.name || "Choose location"} <ChevronDown size={13}/></strong></span></button>
        <div className="header-actions">
          <details className="account-menu" ref={accountMenu}><summary aria-label={user ? `Account for ${user.name}` : "Your account"}><Users size={21}/><span>{user ? user.name.split(" ")[0] : "Account"}</span><ChevronDown size={13}/></summary><div className="account-popover">
            {user ? <p>Hi, {user.name.split(" ")[0]}<small>{label(user.role)} account</small></p> : <button className="primary-button" onClick={() => { accountMenu.current?.removeAttribute("open"); setPanel("login"); }}>Sign in / Register</button>}
            <Link href={viewUrl("orders")} onClick={collapseAccount}><Package size={17}/> My orders & tracking</Link>
            <Link href={viewUrl("saved")} onClick={collapseAccount}><Heart size={17}/> Saved produce</Link>
            {user?.role === "farmer" && <Link href={viewUrl("farm")} onClick={collapseAccount}><Tractor size={17}/> Farmer workspace</Link>}
            {user?.role === "manager" && <Link href={viewUrl("manage")} onClick={collapseAccount}><Store size={17}/> Hub workspace</Link>}
            <button onClick={() => { collapseAccount(); setPanel("help"); }}><CircleHelp size={17}/> Help & support</button>
            {user && <button disabled={busy} onClick={() => void action(async () => { await api("logout/", "POST"); setUser(null); setOrders([]); setInventory([]); setDrops([]); setTrackingOrder(null); setActiveBid(null); navigate("market"); notify("You have signed out."); })}>Sign out</button>}
          </div></details>
          <Link className="header-saved icon-button" href={viewUrl("saved")} aria-label="Saved produce"><Heart size={22}/></Link>
          <Link className="bag-button" href={viewUrl("cart")} aria-label={`Shopping bag, ${count} ${count === 1 ? "item" : "items"}`}><span className="bag-icon"><ShoppingBag size={23}/>{count > 0 && <span className="bag-count">{count}</span>}</span><span>Bag</span></Link>
        </div>
      </div>
      <div className="retail-navigation"><nav aria-label="Shopping navigation">{nav.map((item) => <Link key={item.id} href={viewUrl(item.id)} aria-current={view === item.id ? "page" : undefined}>{item.label}</Link>)}</nav>{view === "market" && <nav className="category-navigation" aria-label="Produce categories">{categories.slice(1).map((item) => <button key={item.id} aria-pressed={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => setView("market", { category: item.id, hub: "", channel: "", q: "" })}><item.icon size={16}/>{item.name}</button>)}</nav>}</div>
    </header>

    <main id="main" ref={pageHeading} tabIndex={-1} className={workspace ? "operations-main" : ""}>
      {workspace && <nav className="workspace-nav" aria-label="Workspace navigation"><span>{view === "farm" ? <Tractor size={20}/> : <Store size={20}/>} {view === "farm" ? "Farmer workspace" : "Hub workspace"}</span>{user?.role === "farmer" && <Link href={viewUrl("requests")}>Find buyer requests <ArrowRight size={15}/></Link>}<Link href="/"><ArrowLeft size={15}/> Back to shopping</Link></nav>}
      {error && !panel && !activeBid && !trackingOrder && <div className="error-banner" role="alert"><CircleHelp size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={17}/></button></div>}
      {resources.session.status === "error" && view !== "orders" && <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/>}
      {(view === "market" || view === "saved") && <>
        {showHero && <section className="hero">
          <div className="hero-content"><h1>Good food.<br/><span>Closer to home.</span></h1><p>Fresh produce from local farms and neighborhood hubs.</p><button className="primary-button" onClick={() => document.getElementById("produce")?.scrollIntoView()}>Shop the harvest <ArrowRight size={17}/></button><button className="hero-hub-link text-button" onClick={() => navigate("hubs")}>Explore hubs <ArrowRight size={16}/></button></div>
          <div className="hero-visual"><ProduceImage src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=85" alt="Fresh vegetables at a local produce market" sizes="(max-width: 700px) 40vw, 50vw" fetchPriority="high"/></div>
        </section>}
        <section id="produce" className="produce-section">
          <div className="section-heading"><div><CatalogHeading>{title}</CatalogHeading><p>{view === "saved" ? "The produce you have your eye on. Saved for this visit." : "Choose your produce. Know your grower."}</p></div><button className="text-button" onClick={() => needLogin("request")}>Can't find it? Request it <ArrowRight size={15}/></button></div>
          <div className="catalog-toolbar"><div className="catalog-count" aria-live="polite">{loading ? "Finding produce…" : resources.products.status === "error" ? "Produce unavailable" : `${shown.length} ${shown.length === 1 ? "product" : "products"}`}{place && ` near ${place.name}`}</div><button className="filter-trigger secondary-button" onClick={() => setPanel("filters")}><SlidersHorizontal size={17}/> Filters{[channel, hub, maxPrice, radius].filter(Boolean).length > 0 && <span>{[channel, hub, maxPrice, radius].filter(Boolean).length}</span>}</button><label className="sort-control"><ArrowDownUp size={16}/><select aria-label="Sort produce" value={sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="recent">Newest first</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>{place && <option value="distance">Nearest first</option>}</select></label></div>
          {(category || query || channel || hub || maxPrice || radius) && <div className="active-filters"><span>{[categories.find((item) => item.id === category && category)?.name, query && `Search: ${query}`, channel && (channel === "hub" ? "Hub produce" : "Farm direct"), hub && hubs.find((item) => String(item.id) === hub)?.name, maxPrice && `Up to ${money(maxPrice)}`, radius && place && `Within ${radius} km`, radius && !place && "Choose your location to apply distance"].filter(Boolean).join(" · ")}</span><button className="text-button" onClick={() => setView(view, { ...emptyFilters, q: "" })}>Clear filters <X size={14}/></button></div>}
          {resources.products.status !== "ready" ? <ResourceFeedback name="produce" state={resources.products} retry={() => setRefresh((value) => value + 1)}/> : shown.length ? <div className="product-grid">{displayProducts.map((product, index) => <Fragment key={product.id}>{groupByFarmer && (index === 0 || displayProducts[index - 1].farmer !== product.farmer) && <h3 className="farmer-group-title"><Sprout size={19}/>{product.farm_name || product.farmer_name}<span>Produce from {product.farmer_name}</span></h3>}<article className="product-card">
            <div className="product-image"><Link className="image-link" aria-label={`View ${product.name}`} href={viewUrl("product", { id: String(product.id) })}><ProduceImage src={product.image} alt={product.name} sizes="(max-width: 700px) calc((100vw - 49px) / 2), (max-width: 960px) 30vw, (max-width: 1440px) 23vw, 322px" loading="lazy"/></Link><span className={`source-badge ${product.channel}`}>{product.channel === "direct" ? "Farm direct" : "At a hub"}</span><button className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`} aria-label={`${saved.includes(product.id) ? "Unsave" : "Save"} ${product.name}`} aria-pressed={saved.includes(product.id)} onClick={() => setSaved((items) => items.includes(product.id) ? items.filter((id) => id !== product.id) : [...items, product.id])}><Heart size={19} fill={saved.includes(product.id) ? "currentColor" : "none"}/></button></div>
            <div className="product-info"><div className="farm-line"><Sprout size={14}/>{product.farm_name || product.farmer_name}</div><Link className="product-title" href={viewUrl("product", { id: String(product.id) })}>{product.name}</Link><div className="product-location"><MapPin size={13}/>{product.location}{product.distance !== undefined && <span> · {product.distance} km</span>}</div><div className="product-bottom"><div><strong>{money(product.price)}</strong><span> / {product.unit}</span></div><button className="add-button" disabled={!bagReady || busy} onClick={() => addToCart(product)} aria-label={`Add ${product.name} to bag`}><Plus size={17}/><span>Add to bag</span></button></div><div className="stock-note">{Number(product.available).toLocaleString()} {product.unit} available</div></div>
          </article></Fragment>)}</div> : <div className="empty-state"><Sprout size={36}/><h3>{view === "saved" ? "Your next favorite is out there" : "No produce matches just yet"}</h3><p>{view === "saved" ? "Tap the heart on a product to keep it here." : "Try another filter, or ask local farmers for what you need."}</p><button className="secondary-button" onClick={() => setView("market", { ...emptyFilters, q: "" })}>Explore all produce <ArrowRight size={16}/></button></div>}
        </section>
        <section className="request-banner"><span className="request-icon"><ShoppingBag size={25}/></span><div><h3>Your shopping list. Their next harvest.</h3><p>Tell local farmers what you need and compare their offers.</p></div><button className="secondary-button" onClick={() => needLogin("request")}>Create an order request <ArrowRight size={16}/></button></section>
        {view === "market" && <><section className="discovery-section"><div className="section-heading"><div><h2>Shop a little closer.</h2><p>Confirmed hub produce, still connected to its farmer.</p></div><Link className="text-button" href={viewUrl("hubs")}>Explore all hubs <ArrowRight size={16}/></Link></div>{resources.hubs.status !== "ready" && <ResourceFeedback name="hubs" state={resources.hubs} retry={() => setRefresh((value) => value + 1)}/>}<div className="hub-shopping-list">{hubs.map((item) => <button key={item.id} onClick={() => { setView("market", { ...emptyFilters, q: "", channel: "hub", hub: String(item.id) }); document.getElementById("produce")?.scrollIntoView(); }}><Store size={29}/><span><strong>{item.name}</strong><small><MapPin size={13}/>{item.location}</small></span><ArrowRight size={20}/></button>)}</div></section>
        <section className="discovery-section"><div className="section-heading"><div><h2>Good food has a grower.</h2><p>Meet the farms behind this market.</p></div></div>{catalogStatus !== "ready" ? <ResourceFeedback name="growers" state={{ status: catalogStatus, error: "Growers could not be loaded." }} retry={() => setRefresh((value) => value + 1)}/> : <div className="farmer-shopping-list">{farmers.map((farmer) => <article key={farmer.farmer}><div className="farmer-portrait"><ProduceImage src={farmer.image} alt={`Produce from ${farmer.farm_name || farmer.farmer_name}`} sizes="120px" loading="lazy"/></div><div><h3>{farmer.farm_name || farmer.farmer_name}</h3><p>Grown by {farmer.farmer_name}</p><button className="text-button" onClick={() => { setView("market", { ...emptyFilters, q: farmer.farm_name || farmer.farmer_name }); document.getElementById("produce")?.scrollIntoView(); }}>Shop this farm <ArrowRight size={16}/></button></div></article>)}</div>}</section>
        <section className="trust-strip" aria-label="Ways to shop"><div><Sprout/><span><strong>Direct from the farm</strong><small>Choose produce from a named grower</small></span></div><div><Store/><span><strong>Collected at a hub</strong><small>Hub receipt confirmed before sale</small></span></div><div><ShoppingBag/><span><strong>Your request, their offer</strong><small>Compare bids for what you need</small></span></div></section></>}
      </>}

      {view === "product" && <section className="shopping-page">
        <Link className="back-link" href={viewUrl("market")}><ArrowLeft size={17}/> Back to produce</Link>
        {catalogStatus === "loading" ? <div className="loading-state"><LoaderCircle className="spinner"/> Loading produce…</div> : catalogStatus === "error" ? <CatalogRetry retry={() => setRefresh((value) => value + 1)}/> : detail ? <>
          <div className="product-detail-page"><ProduceImage className="detail-image" src={detail.image} alt={detail.name} sizes="(max-width: 700px) 100vw, (max-width: 1440px) 50vw, 645px" fetchPriority="high"/>
            <div className="detail-content"><span className="status-pill green">{detail.channel === "hub" ? "Confirmed at hub" : "Direct from farm"}</span><h1>{detail.name}</h1><p className="detail-farmer"><Sprout size={18}/>{detail.farm_name || detail.farmer_name}</p><p className="detail-description">{detail.description}</p>
              <div className="detail-price">{money(detail.price)} <span>/ {detail.unit}</span></div>
              <p className="stock-note">{Number(detail.available).toLocaleString()} {detail.unit} available</p>
              <form className="detail-purchase" onSubmit={(event) => { event.preventDefault(); addToCart(detail, Number(detailQuantity)); }}><Field title={`Quantity (${detail.unit})`}><input aria-label={`Quantity in ${detail.unit}`} type="number" inputMode="decimal" min=".01" max={detail.available} step=".01" required value={detailQuantity} onChange={(event) => setDetailQuantity(event.target.value)}/></Field><button className="primary-button" disabled={!bagReady || busy}><ShoppingBag size={18}/> Add to bag</button></form>
              <Link className="text-button" href={viewUrl("cart")}>View your bag <ArrowRight size={16}/></Link>
              <dl className="detail-facts"><div><dt>Farmer</dt><dd>{detail.farmer_name}</dd></div><div><dt>Pickup origin</dt><dd>{detail.channel === "hub" ? detail.hub_name : detail.location}</dd></div><div><dt>Harvest / production date</dt><dd>{new Date(`${detail.harvest_date}T12:00:00`).toLocaleDateString("en-KE")}</dd></div></dl>
              <p className="muted small">Local preview. Delivery fees and live payments are not configured. Stock and prices are checked again when you reserve an order.</p>
            </div>
          </div>
        </> : <div className="empty-state"><Sprout size={36}/><h1>This produce is no longer available.</h1><p>Browse the current harvest to find something else.</p><Link className="primary-button" href="/">Shop produce <ArrowRight size={16}/></Link></div>}
      </section>}

      {view === "cart" && <section className="shopping-page">
        <Link className="back-link" href="/"><ArrowLeft size={17}/> Continue shopping</Link><div className="section-heading"><div><h1>Your market bag</h1><p>{count} {count === 1 ? "product" : "products"} picked for your table.</p></div></div>
        {!bagReady ? catalogStatus === "error" ? <CatalogRetry retry={() => setRefresh((value) => value + 1)}/> : <div className="loading-state"><LoaderCircle className="spinner"/> Opening your bag…</div> : cart.length ? <div className="shopping-columns"><div>
          {cartGroups.length > 1 && <div className="notice-inline"><Store size={20}/> Your bag has {cartGroups.length} pickups. Check out each farm and pickup separately; the rest stays in your bag.</div>}
          {cartGroups.map((group) => <section className="bag-group" key={group.key}><header><div><h2>{group.farmer}</h2><p><MapPin size={15}/>{group.pickup} · {group.items[0].listing.channel === "hub" ? "Hub pickup" : "Farm pickup"}</p></div><Sprout size={23}/></header>
            <BagItems items={group.items} updateQuantity={updateQuantity} busy={busy}/>
            <div className="bag-group-footer"><span>Pickup subtotal <strong>{money(group.total)}</strong></span><Link className="primary-button" href={viewUrl("checkout", { origin: group.key })}>{cartGroups.length > 1 ? "Checkout this pickup" : "Continue to checkout"} <ArrowRight size={17}/></Link></div>
          </section>)}
        </div><aside className="order-summary" aria-label="Bag summary"><h2>Bag summary</h2><div className="summary-line"><span>Produce subtotal</span><strong>{money(total)}</strong></div><div className="summary-line"><span>Pickup origins</span><strong>{cartGroups.length}</strong></div><p>Delivery fees are not configured. Each pickup creates a separate order.</p><div className="notice-inline"><ShieldCheck size={18}/><span>Local preview. No payment is collected at checkout.</span></div><Link className="text-button" href="/">Add more produce <ArrowRight size={16}/></Link></aside></div> : <EmptyBag/>}
      </section>}

      {view === "checkout" && <section className="shopping-page">
        <Link className="back-link" href={viewUrl("cart")}><ArrowLeft size={17}/> Back to your bag</Link><div className="section-heading"><div><h1>Checkout</h1><p>Confirm your produce and tell us where it's going.</p></div></div>
        {!bagReady ? catalogStatus === "error" ? <CatalogRetry retry={() => setRefresh((value) => value + 1)}/> : <div className="loading-state"><LoaderCircle className="spinner"/> Loading checkout…</div> : !cart.length ? <EmptyBag/> : !checkoutGroup ? <div className="empty-state"><Store size={35}/><h2>Choose a pickup to check out.</h2><p>Each farm and hub origin has its own checkout.</p><Link className="primary-button" href={viewUrl("cart")}>Choose from your bag <ArrowRight size={16}/></Link></div> : <div className="shopping-columns">
          <div className="checkout-content"><section className="checkout-section"><h2>Your pickup</h2><p><strong>{checkoutGroup.farmer}</strong> · {checkoutGroup.pickup}</p><BagItems items={checkoutGroup.items}/><Link className="text-button" href={viewUrl("cart")}>Edit bag <ArrowRight size={15}/></Link></section>
          <section className="checkout-section"><h2>Delivery details</h2>{resources.session.status !== "ready" ? <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/> : !user ? <><p className="muted">Sign in to save your order. Your bag and this checkout will stay here.</p><button className="primary-button" onClick={() => setPanel("login")}>Sign in to continue <ArrowRight size={17}/></button></> : <form className="form-stack" onSubmit={(event) => {
            event.preventDefault();
            const data = formValues(event);
            const submittedItems = checkoutGroup.items;
            void action(async () => {
              await api("checkout/", "POST", { ...data, key: checkoutKey.current, items: submittedItems.map((item) => ({ listing: item.listing.id, quantity: item.quantity })) });
              setCart((items) => items.filter((item) => !submittedItems.some((submitted) => submitted.listing.id === item.listing.id)));
              checkoutKey.current = crypto.randomUUID(); setView("orders"); setRefresh((value) => value + 1);
              notify("Order saved as unpaid. Stock is reserved for 15 minutes. Other pickups remain in your bag.");
            });
          }}><p className="signed-in-note">Ordering as <strong>{user.name}</strong></p><Field title="Delivery address & landmark"><textarea name="address" autoComplete="street-address" required rows={3} maxLength={300} placeholder="Estate, road, building and a useful landmark"/></Field><Field title="Preferred payment method"><select name="method"><option value="mpesa">M-Pesa</option><option value="card">Card</option></select></Field><div className="notice-inline"><CircleHelp size={19}/><span>This creates an unpaid order with a 15-minute stock reservation. M-Pesa and card payments are not connected. No money will be collected.</span></div><button disabled={busy} className="primary-button full-width">{busy ? "Reserving produce…" : "Reserve & create unpaid order"}<ArrowRight size={17}/></button></form>}</section></div>
          <aside className="order-summary" aria-label="Order summary"><h2>Order summary</h2><div className="summary-line"><span>{checkoutGroup.items.length} {checkoutGroup.items.length === 1 ? "product" : "products"}</span><strong>{money(checkoutGroup.total)}</strong></div><div className="summary-line"><span>Delivery</span><span>Not yet priced</span></div><div className="summary-line summary-total"><span>Produce subtotal</span><strong>{money(checkoutGroup.total)}</strong></div><p>The server confirms current prices and stock when you reserve. Delivery fees are not included.</p><p><ShieldCheck size={16}/> No payment taken in this preview.</p></aside>
        </div>}
      </section>}

      {view === "requests" && <section className="workspace"><div className="section-heading"><div><h1>Good food starts with a request.</h1><p>Tell farmers what you need. Let the right harvest find you.</p></div><button className="primary-button" onClick={() => needLogin("request")}><Plus size={17}/> Post a request</button></div><div className="notice-inline"><ShoppingBag size={19}/> Farmers offer a price per unit for your full requested quantity. Accept an offer to reserve stock for checkout.</div>{searchSummary}{searchStatus !== "ready" ? searchFeedback : <><div className="request-list">{requests.map((need) => <article className="request-card" key={need.id}><div className="request-card-top"><span className={`status-pill ${need.status === "open" ? "green" : ""}`}>{need.deadline < today() && need.status === "open" ? "expired" : label(need.status)}</span><small><Clock3 size={13}/> Until {new Date(`${need.deadline}T12:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</small></div><h2>{need.name}</h2><p>{need.notes}</p><div className="request-facts"><strong>{Number(need.quantity)} {need.unit}</strong><span>Budget {money(need.budget)}</span><span><MapPin size={14}/>{need.location}</span></div><div className="request-card-footer"><span>Requested by {need.consumer_name || "a local buyer"}</span><strong>{need.bids.length} {need.bids.length === 1 ? "offer" : "offers"}</strong></div>
        {need.is_owner && need.bids.map((bid) => <div className="bid-row" key={bid.id}><div><strong>{bid.farm_name || bid.farmer_name}</strong><p>{bid.message || bid.listing_name}</p><span>{money(bid.price)} / {need.unit} · Total {money(Number(bid.price) * Number(need.quantity))}</span></div>{need.status === "open" && <button disabled={busy} className="secondary-button" onClick={() => { setActiveBid(bid.id); }}>Accept offer <ArrowRight size={15}/></button>}</div>)}
        {user?.role === "farmer" && !need.is_owner && need.status === "open" && need.deadline >= today() && (resources.inventory.status !== "ready" ? <ResourceFeedback name="stock for offers" state={resources.inventory} retry={() => setRefresh((value) => value + 1)}/> : inventory.some((item) => item.unit === need.unit && Number(item.available) >= Number(need.quantity) && (item.channel === "direct" || item.received)) ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api(`requests/${need.id}/bids/`, "POST", values); notify("Your offer has been sent."); setRefresh((value) => value + 1); }); }}><Field title="Your produce"><select name="listing" required defaultValue=""><option value="" disabled>Choose your stock</option>{inventory.filter((item) => item.unit === need.unit && Number(item.available) >= Number(need.quantity) && (item.channel === "direct" || item.received)).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.available} {item.unit})</option>)}</select></Field><Field title={`Price per ${need.unit} (KES)`}><input name="price" type="number" step=".01" min=".01" required/></Field><Field title="Message"><input name="message" maxLength={400} placeholder="What makes your produce a good fit?"/></Field><button className="primary-button" disabled={busy}>Send offer</button></form> : <p className="notice-inline">No available stock covers this request's full quantity and unit. Add suitable stock in your farmer workspace before offering.</p>)}
      </article>)}</div>{!requests.length && <div className="empty-state"><ShoppingBag size={35}/><h2>{requestQuery ? "No requests match your search" : "Be the first to ask"}</h2><p>{requestQuery ? "Try another produce name, description or location, or clear your search." : "Post a request and connect with local growers."}</p></div>}</>}</section>}

      {view === "hubs" && <section className="workspace"><div className="section-heading"><div><h1>Your neighborhood harvest.</h1><p>Discover local aggregation hubs. Every product stays connected to its farmer.</p></div></div>{searchSummary}{searchStatus !== "ready" ? searchFeedback : hubResults.length ? <div className="hub-grid">{hubResults.map((item) => <article className="hub-card" key={item.id}><div className="hub-content"><Store size={28} aria-hidden="true"/><h2>{item.name}</h2><p><MapPin size={16}/>{item.location}</p><p>Browse produce received and confirmed by the hub manager, with each farmer clearly identified.</p><button className="secondary-button" onClick={() => setView("market", { ...emptyFilters, q: "", channel: "hub", hub: String(item.id) })}>Shop this hub <ArrowRight size={16}/></button><a href={`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`} target="_blank" rel="noreferrer">View location <ArrowUpRightIcon/></a></div></article>)}</div> : <div className="empty-state"><Store size={35}/><h2>{hubQuery ? "No hubs match your search" : "No hubs available yet"}</h2><p>{hubQuery ? "Try another hub name or location, or clear your search." : "Check back soon for local aggregation hubs."}</p></div>}</section>}

      {view === "orders" && <section className="workspace">
        <div className="section-heading"><div><h1>From farm to your doorstep.</h1><p>Your orders, delivery progress, and a little peace of mind.</p></div><button className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Refresh orders</button></div>
        {resources.session.status !== "ready" ? <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/> : !user ? <SignInPrompt onClick={() => setPanel("login")}/> : resources.orders.status !== "ready" ? <ResourceFeedback name="orders" state={resources.orders} retry={() => setRefresh((value) => value + 1)}/> : orders.length ? <div className="order-list">{orders.map((order) => <article className="order-card" key={order.id}>
          <div className="order-top"><div><small>ORDER #{order.id.slice(0, 8).toUpperCase()}</small><p>{new Date(order.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}</p></div><OrderStatus status={order.status}/></div>
          {order.items.map((item) => <div className="order-item" key={item.id}><ProduceImage src={item.image} alt={item.name} sizes="70px" loading="lazy"/><div><strong>{item.name}</strong><p>{item.quantity} {item.unit} · {item.farmer_name}</p></div><strong>{money(Number(item.quantity) * Number(item.price))}</strong></div>)}
          <div className="order-address"><MapPin size={15}/>{order.address}</div>
          {order.status === "pending_payment" && <ReservationNotice order={order} expired={() => setRefresh((value) => value + 1)}/>}
          <div className="order-footer"><div><small>{order.payment_status === "demo" ? "DEMO ORDER · NO PAYMENT TAKEN" : `PAYMENT ${label(order.payment_status).toUpperCase()}`}</small><strong>{money(order.total)}</strong></div><div>
            {order.status === "pending_payment" && <><button disabled={busy} className="text-button" onClick={() => void action(async () => { await api(`orders/${order.id}/cancel/`, "POST"); notify("Order cancelled. Stock released."); setRefresh((value) => value + 1); })}>Cancel reservation</button><button disabled className="secondary-button" aria-describedby={`payment-note-${order.id}`}>Payments unavailable in preview</button></>}
            <button className="secondary-button" onClick={() => setTrackingOrder(order)}>View progress <ArrowRight size={15}/></button>
          </div></div>
        </article>)}</div> : <div className="empty-state"><Package size={36}/><h3>Your first harvest is waiting</h3><p>Orders you place will appear here.</p><button className="primary-button" onClick={() => navigate("market")}>Explore produce <ArrowRight size={16}/></button></div>}
      </section>}

      {view === "farm" && user?.role === "farmer" && <section className="workspace">
        <div className="section-heading"><div><h1>{user.farm_name || "Your farm, connected."}</h1><p>Manage your produce, hub drops, and incoming orders.</p></div><button className="primary-button" onClick={() => setPanel("listing")}><Plus size={17}/> Add produce</button></div>
        <div className="notice-inline"><Sprout size={20}/> Each stock entry has one pickup origin. Split your quantity into separate farm and hub entries to sell through both without duplicating inventory.</div>
        <h2 className="workspace-subtitle">Your inventory</h2>
        {resources.inventory.status !== "ready" ? <ResourceFeedback name="inventory" state={resources.inventory} retry={() => setRefresh((value) => value + 1)}/> : inventory.length ? <div className="inventory-table" tabIndex={0} role="region" aria-label="Scrollable farm inventory">
          <table><caption className="sr-only">Your produce inventory and pickup status</caption><thead><tr><th scope="col">Produce</th><th scope="col">Available</th><th scope="col">Price</th><th scope="col">Pickup / status</th></tr></thead><tbody>
            {inventory.map((item) => <tr key={item.id}><th scope="row">{item.name}<small>{item.location}</small></th><td>{item.available} {item.unit}</td><td>{money(item.price)}</td><td><span className="status-pill">{item.channel === "direct" ? "Farm direct" : item.received ? "At hub" : "Awaiting receipt"}</span></td></tr>)}
          </tbody></table>
        </div> : <div className="empty-state"><Sprout size={35}/><h3>Share your first harvest</h3><p>Add produce with a price and pickup origin so shoppers can find your farm.</p><button className="primary-button" onClick={() => setPanel("listing")}>Add your first produce <Plus size={17}/></button></div>}
        <h2 className="workspace-subtitle">Incoming orders</h2>
        {resources.orders.status !== "ready" ? <ResourceFeedback name="incoming orders" state={resources.orders} retry={() => setRefresh((value) => value + 1)}/> : orders.filter((order) => order.status !== "cancelled").length ? orders.filter((order) => order.status !== "cancelled").map((order) => <div className="simple-row" key={order.id}><span>#{order.id.slice(0, 8)} · {order.items.map((item) => item.name).join(", ")}</span><OrderStatus status={order.status}/><strong>{money(order.total)}</strong></div>) : <p className="muted">Orders from your shoppers will appear here. You can also <Link href={viewUrl("requests")}>find buyer requests</Link> and offer your available stock.</p>}
      </section>}

      {view === "manage" && user?.role === "manager" && <section className="workspace"><div className="section-heading"><div><h1>A fresh start at your hub.</h1><p>Confirm farmer drops before making produce available to shoppers.</p></div></div>{resources.drops.status !== "ready" ? <ResourceFeedback name="hub drops" state={resources.drops} retry={() => setRefresh((value) => value + 1)}/> : <>{drops.map((item) => <article className="simple-row" key={item.id}><div><strong>{item.name}</strong><p>{item.farmer_name} · {item.quantity} {item.unit} · {item.hub_name}</p></div>{item.received ? <span className="status-pill green"><Check size={14}/> Receipt confirmed</span> : <button disabled={busy} className="primary-button" onClick={() => void action(async () => { await api(`hub-drops/${item.id}/receive/`, "POST"); notify("Receipt confirmed. This produce is now available."); setRefresh((value) => value + 1); })}>Confirm full receipt</button>}</article>)}{!drops.length && <div className="empty-state"><Store size={35}/><h3>No drops to receive</h3><p>Farmer hub listings will appear here. Confirm a drop only after you have checked its full quantity.</p></div>}</>}</section>}
      {workspace && resources.session.status === "loading" && <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/>}
      {workspace && resources.session.status === "ready" && (view === "farm" ? user?.role !== "farmer" : user?.role !== "manager") && <section className="workspace"><div className="empty-state"><Store size={36}/><h1>{user ? "This workspace needs a different account." : "Sign in to your workspace."}</h1><p>{user ? `Use a ${view === "farm" ? "farmer" : "hub manager"} account to manage this workspace.` : "Your shopping bag will stay here while you sign in."}</p>{!user && <button className="primary-button" onClick={() => setPanel("login")}>Sign in <ArrowRight size={16}/></button>}</div></section>}
      <footer className="page-footer"><span className="footer-brand"><Sprout size={16}/> SokoSoo</span><span>Good food. Fair connections.</span><span className="demo-label">Local preview · Sample catalog</span></footer>
    </main>

    {notice && <div className="toast" role="status"><CheckCircle2 size={19}/><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></button></div>}

    {(panel === "login" || panel === "register") && <Drawer title={panel === "login" ? "Welcome to SokoSoo" : "Your local market awaits"} close={() => { setPanel(null); resumePanel.current = null; }}><p className="drawer-intro">{panel === "login" ? "Good food and real connections, one sign-in away." : "Join a community growing a better way to buy and sell."}</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = formValues(event); void action(async () => { const result = await api<{ user: User }>(`${panel}/`, "POST", data); setUser(result.user); setPanel(resumePanel.current); resumePanel.current = null; setRefresh((value) => value + 1); notify(`Welcome, ${result.user.name.split(" ")[0]}!`); }); }}>
      {panel === "register" && <><Field title="Full name"><input name="name" autoComplete="name" required maxLength={100}/></Field><Field title="Email address"><input name="email" type="email" autoComplete="email" required/></Field></>}
      <Field title="Username"><input name="username" autoComplete="username" autoCapitalize="none" required maxLength={150}/></Field><Field title="Password"><input name="password" type="password" autoComplete={panel === "login" ? "current-password" : "new-password"} required minLength={panel === "register" ? 8 : undefined}/></Field>
      {panel === "register" && <><Field title="I'm joining as"><select name="role"><option value="consumer">A consumer — I want to shop</option><option value="farmer">A farmer — I want to sell</option></select></Field><Field title="Farm name (if you're a farmer)"><input name="farm_name" maxLength={120}/></Field></>}
      <button className="primary-button full-width" disabled={busy}>{busy ? <><LoaderCircle className="spinner" size={18} aria-hidden="true"/>{panel === "login" ? "Signing in..." : "Creating account..."}</> : panel === "login" ? "Sign in" : "Create account"}<ArrowRight size={17}/></button></form><p className="auth-switch">{panel === "login" ? "New to the neighborhood?" : "Already have an account?"} <button className="text-button" onClick={() => { setPanel(panel === "login" ? "register" : "login"); setError(""); }}>{panel === "login" ? "Join SokoSoo" : "Sign in"}</button></p><div className="demo-credentials"><strong>Explore the local demo</strong><p>Username: <code>consumer</code>, <code>farmer</code>, or <code>manager</code><br/>Password: <code>SokoDemo2026!</code></p><small>Sample accounts and produce. No live payments.</small></div></Drawer>}

    {panel === "filters" && <Drawer title="Find your produce" close={() => setPanel(null)}>{filters}<button className="primary-button full-width" onClick={() => setPanel(null)}>Show {shown.length} products <ArrowRight size={17}/></button></Drawer>}

    {panel === "request" && <Drawer title="What's on your shopping list?" close={() => setPanel(null)}><p className="drawer-intro">Tell local farmers what you need. Compare their offers and choose your grower.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api("requests/", "POST", values); setPanel(null); setView("requests", { requests_q: "" }); setRefresh((value) => value + 1); notify("Your request is open for farmer offers."); }); }}><Field title="What do you need?"><input name="name" placeholder="e.g. Tomatoes for our community kitchen" required maxLength={120}/></Field><div className="form-columns"><Field title="Quantity"><input name="quantity" type="number" min=".01" step=".01" required/></Field><UnitField/></div><Field title="Total budget (KES)"><input name="budget" type="number" min=".01" step=".01" required/></Field><Field title="Delivery area"><input name="location" defaultValue={place?.name || ""} placeholder="e.g. Kilimani, Nairobi" required maxLength={120}/></Field><Field title="Receive offers until"><input type="date" name="deadline" min={today()} required/></Field><Field title="Anything else farmers should know?"><textarea name="notes" rows={3} placeholder="Ripeness, quality, preferred delivery day…"/></Field><button className="primary-button full-width" disabled={busy}>Post request <ArrowRight size={17}/></button></form></Drawer>}

    {panel === "listing" && <Drawer title="Share your harvest" close={() => setPanel(null)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api("listings/", "POST", { ...values, hub: values.channel === "hub" ? Number(values.hub) : null }); setPanel(null); setView("farm"); setRefresh((value) => value + 1); notify(values.channel === "hub" ? "Drop declared. A manager must confirm receipt before sale." : "Your produce is now listed."); }); }}>
      <Field title="Produce name"><input name="name" required maxLength={120}/></Field><Field title="Category"><select name="category">{categories.slice(1).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <div className="form-columns"><Field title="Price per unit (KES)"><input name="price" type="number" step=".01" min=".01" max="99999999.99" required/></Field><UnitField/></div>
      <Field title="Quantity for this pickup origin"><input name="quantity" type="number" step=".01" min=".01" required/></Field><Field title="Pickup type"><select name="channel" value={listingChannel} onChange={(event) => setListingChannel(event.target.value)}><option value="direct">Direct from farm</option><option value="hub">Hub drop</option></select></Field>
      {listingChannel === "hub" && <><Field title="Aggregation hub"><select name="hub" required disabled={resources.hubs.status !== "ready"}>{hubs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>{resources.hubs.status !== "ready" && <ResourceFeedback name="hubs" state={resources.hubs} retry={() => setRefresh((value) => value + 1)}/>}</>}
      <Field title="Farm area"><input name="location" required placeholder="e.g. Limuru, Kiambu" maxLength={120}/></Field><FarmCoordinates/>
      <Field title="Harvest / production / slaughter date"><input name="harvest_date" type="date" max={today()} required/></Field><Field title="Photo URL (optional)"><input name="image" type="url" placeholder="https://…"/></Field><Field title="Description"><textarea name="description" rows={3}/></Field>
      <button disabled={busy || (listingChannel === "hub" && resources.hubs.status !== "ready")} className="primary-button full-width">{listingChannel === "hub" ? "Declare hub drop" : "List produce"}<ArrowRight size={17}/></button>
    </form></Drawer>}

    {panel === "location" && <Drawer title="Bring your market closer" close={() => setPanel(null)}><p className="drawer-intro">Choose your area to see nearby farms and hubs. Distance is straight-line, not a delivery quote. A chosen area stays in the URL; precise GPS is kept only for this visit.</p><button className="secondary-button full-width" disabled={busy} onClick={() => { if (!navigator.geolocation) { setError("Location is unavailable. Select an area below."); return; } setBusy(true); navigator.geolocation.getCurrentPosition((position) => { setPlace({ name: "your location", lat: position.coords.latitude, lng: position.coords.longitude }); setFilter("area", ""); setBusy(false); setPanel(null); notify("Location updated. You can now filter by distance."); }, () => { setBusy(false); setError("Location permission was denied or GPS is unavailable. Choose an area below."); }, { timeout: 15000 }); }}><MapPin size={17}/>{busy ? "Finding your location…" : "Use my current location"}</button><h3 className="workspace-subtitle">Or choose an area</h3>{areas.map((area) => <button key={area.id} className="location-choice" onClick={() => { setPlace(null); setFilter("area", area.id); setPanel(null); }}><MapPin size={18}/>{area.name}<ChevronRight size={16}/></button>)}{place && <button className="text-button" onClick={() => { setPlace(null); setView(view, { area: "", radius: "", sort: sort === "distance" ? "" : sort }); setPanel(null); }}>Clear location <X size={15}/></button>}</Drawer>}

    {panel === "help" && <Drawer title="A helping hand" close={() => setPanel(null)}><div className="help-content"><h3>Three ways to shop</h3><p>Buy directly from a farm, shop confirmed hub inventory, or post a request and compare farmer offers.</p><h3>About this preview</h3><p>This is a working local marketplace with sample produce. Live payments, delivery fees, push notifications, and production dispatch are not enabled.</p><h3>Where is my delivery?</h3><p>Open My orders, then View progress. A driver's last known location appears only during an active delivery.</p><h3>Stock at a hub</h3><p>Hub managers must confirm a farmer's drop before it becomes available to shoppers.</p></div></Drawer>}

    {activeBid && <Drawer title="Accept this farmer's offer" close={() => setActiveBid(null)}><p className="drawer-intro">Your produce will be reserved for 15 minutes. This preview creates an unpaid order; no money will be collected.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api(`bids/${activeBid}/accept/`, "POST", { ...values, key: awardKey.current }); awardKey.current = crypto.randomUUID(); setActiveBid(null); setView("orders"); setRefresh((value) => value + 1); notify("Offer accepted. View your unpaid order to continue."); }); }}><Field title="Delivery address"><textarea name="address" maxLength={300} required rows={3}/></Field><button className="primary-button full-width" disabled={busy}>Accept & reserve stock <ArrowRight size={17}/></button></form></Drawer>}

    {trackingOrder && <Drawer title={`Order #${trackingOrder.id.slice(0, 8).toUpperCase()}`} close={() => setTrackingOrder(null)}>
      <OrderStatus status={trackingOrder.status}/><h3 className="workspace-subtitle">Your delivery journey</h3>
      {trackingOrder.payment_status === "demo" && <p className="notice-inline">Sample delivery only. No live driver or payment.</p>}
      {trackingOrder.status === "cancelled" ? <p className="notice-inline">This order was cancelled. No delivery will take place.</p> : <ol className="timeline">{["processing", "picked", "en_route", "delivered"].map((stage, index) => { const current = ["processing", "picked", "en_route", "delivered"].indexOf(trackingOrder.status); return <li key={stage} className={current >= index ? "complete" : ""}><span>{current >= index ? <Check size={14}/> : index + 1}</span><div><strong>{label(stage)}</strong><small>{stage === "processing" ? "Your order is being prepared" : stage === "picked" ? "Your driver has collected the produce" : stage === "en_route" ? "Your harvest is on its way" : "Enjoy something fresh"}</small></div></li>; })}</ol>}
      {trackingOrder.status === "pending_payment" && <p className="notice-inline">Awaiting payment. Delivery has not started. Payments are unavailable in this preview.</p>}
      {trackingOrder.location ? <div className="location-update"><MapPin size={23}/><h3>Last known driver location</h3><p>{new Date(trackingOrder.location.recorded_at).toLocaleTimeString()} · ±{Math.round(trackingOrder.location.accuracy)} m</p><p>{Date.now() - new Date(trackingOrder.location.recorded_at).getTime() > 60000 ? "Location is stale. Waiting for the driver to reconnect." : "Location recently updated."}</p><a className="secondary-button" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${trackingOrder.location.latitude},${trackingOrder.location.longitude}`}>Open location on map <ArrowUpRightIcon/></a></div> : trackingOrder.status !== "cancelled" && <p className="muted">Live location will appear when the assigned driver begins an active delivery. This view refreshes every 10 seconds.</p>}
      <h3 className="workspace-subtitle">Order history</h3>{trackingOrder.events.map((event, index) => <div className="history-row" key={index}><span>{label(event.status)}</span><small>{new Date(event.created_at).toLocaleString("en-KE")}</small></div>)}
      {trackingOrder.status === "delivered" && !trackingOrder.review && <form className="form-stack review-form" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api(`orders/${trackingOrder.id}/review/`, "POST", values); setTrackingOrder(null); setRefresh((value) => value + 1); notify("Thank you for sharing your experience."); }); }}><h3>How was your harvest?</h3><RatingField name="produce_rating" title="Produce quality"/><RatingField name="delivery_rating" title="Delivery experience"/><Field title="Your review"><textarea name="comment" rows={3} maxLength={1000}/></Field><button disabled={busy} className="primary-button">Submit review</button></form>}
    </Drawer>}
  </div></FeedbackContext.Provider>;
}

function BagItems({ items, updateQuantity, busy = false }: { items: CartItem[]; updateQuantity?: (id: number, change: number) => void; busy?: boolean }) {
  const searchParams = useSearchParams();
  const searches = Object.fromEntries([...searchParams].filter(([key]) => ["q", "requests_q", "hubs_q", "area", ...filterKeys].includes(key)));
  return <div className="cart-items">{items.map(({ listing, quantity }) => <article className="cart-item" key={listing.id}>
    <Link href={routeUrl("product", { ...searches, id: String(listing.id) })} tabIndex={-1} aria-hidden="true"><ProduceImage src={listing.image} alt="" sizes="95px" loading="lazy"/></Link>
    <div><Link className="cart-item-name" href={routeUrl("product", { ...searches, id: String(listing.id) })}>{listing.name}</Link><small>{money(listing.price)} / {listing.unit}</small>
      {updateQuantity ? <div className="cart-item-actions"><div className="quantity-control"><button aria-label={`Reduce ${listing.name} quantity`} disabled={busy} onClick={() => updateQuantity(listing.id, -1)}><Minus size={15}/></button><span>{quantity} {listing.unit}</span><button aria-label={`Increase ${listing.name} quantity`} disabled={busy || quantity >= Number(listing.available)} onClick={() => updateQuantity(listing.id, 1)}><Plus size={15}/></button></div><button className="remove-item" disabled={busy} onClick={() => updateQuantity(listing.id, -quantity)} aria-label={`Remove ${listing.name} from bag`}>Remove</button></div> : <p className="checkout-item-quantity">{quantity} {listing.unit}</p>}
    </div><strong>{money(Number(listing.price) * quantity)}</strong>
  </article>)}</div>;
}
function EmptyBag() {
  return <div className="empty-state"><ShoppingBag size={40}/><h2>A little room for something fresh.</h2><p>Add produce to start your market bag.</p><Link className="primary-button" href="/">Explore produce <ArrowRight size={17}/></Link></div>;
}
function ResourceFeedback({ name, state, retry }: { name: string; state: LoadState; retry: () => void }) {
  if (state.status === "loading") return <div className="loading-state" role="status"><LoaderCircle className="spinner" aria-hidden="true"/> Loading {name}…</div>;
  return <div className="empty-state"><CircleHelp size={35} aria-hidden="true"/><h2>Could not load {name}</h2><p role="alert">{state.error} Your existing data has not been changed.</p><button className="secondary-button" onClick={retry}>Retry {name} <ArrowRight size={16}/></button></div>;
}
function ProduceImage({ src, sizes = "100vw", alt, ...props }: ComponentProps<"img"> & { src?: string }) {
  const source = src || "/icon.svg";
  return <img {...props} src={source} alt={alt} {...responsiveImage(source, sizes)} decoding="async"/>;
}
function OrderStatus({ status }: { status: string }) {
  const tone = status === "cancelled" ? "error" : status === "pending_payment" ? "warning" : "green";
  return <span className={`status-pill ${tone}`}>{label(status)}</span>;
}
function ReservationNotice({ order, expired }: { order: Order; expired: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const onExpiry = useRef(expired);
  onExpiry.current = expired;
  const deadline = new Date(order.expires_at).getTime();
  useEffect(() => {
    let notified = false;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline && !notified) { notified = true; onExpiry.current(); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return <div className="reservation-note"><p>{now < deadline ? <>Stock reserved until <time dateTime={order.expires_at}>{new Date(order.expires_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</time> · {Math.ceil((deadline - now) / 60000)} min remaining.</> : "Reservation expired. Refresh orders to confirm the released stock."}</p><p id={`payment-note-${order.id}`}>M-Pesa and card payments are not connected. No money has been collected; you can cancel or let this reservation expire.</p></div>;
}
function FarmCoordinates() {
  const [coordinates, setCoordinates] = useState({ latitude: "", longitude: "" });
  const [state, setState] = useState({ loading: false, error: "", notice: "" });
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function locate() {
    if (!navigator.geolocation) { setState({ loading: false, error: "GPS is unavailable. Enter your farm coordinates below.", notice: "" }); return; }
    setState({ loading: true, error: "", notice: "" });
    navigator.geolocation.getCurrentPosition((position) => {
      if (!active.current) return;
      setCoordinates({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
      setState({ loading: false, error: "", notice: "Coordinates filled. Check that they describe your farm before listing." });
    }, () => { if (active.current) setState({ loading: false, error: "Could not get GPS. Allow location access or enter your farm coordinates below.", notice: "" }); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  return <fieldset className="coordinate-fields"><legend>Farm location</legend><p className="muted">At your farm? Use GPS to fill its coordinates. Otherwise enter its exact latitude and longitude, not a nearby hub.</p><button type="button" className="secondary-button" onClick={locate} disabled={state.loading}><MapPin size={17}/>{state.loading ? "Finding farm location…" : "Use my current farm location"}</button>{state.error && <p className="field-error" role="alert">{state.error}</p>}{state.notice && <p role="status" className="muted">{state.notice}</p>}<div className="form-columns"><Field title="Farm latitude"><input name="latitude" type="number" step="any" min="-90" max="90" required value={coordinates.latitude} onChange={(event) => setCoordinates((current) => ({ ...current, latitude: event.target.value }))}/></Field><Field title="Farm longitude"><input name="longitude" type="number" step="any" min="-180" max="180" required value={coordinates.longitude} onChange={(event) => setCoordinates((current) => ({ ...current, longitude: event.target.value }))}/></Field></div></fieldset>;
}
function CatalogRetry({ retry }: { retry: () => void }) {
  return <div className="empty-state"><CircleHelp size={35}/><h2>We couldn't load the market.</h2><p>Check your connection and try again. Your saved bag has not been changed.</p><button className="primary-button" onClick={retry}>Try again <ArrowRight size={16}/></button></div>;
}
function UnitField() {
  return <Field title="Unit"><select name="unit"><option value="kg">Kilograms (kg)</option><option value="litre">Litres</option><option value="tray">Trays</option><option value="head">Head</option><option value="piece">Pieces</option></select></Field>;
}
function RatingField({ name, title }: { name: string; title: string }) {
  return <Field title={title}><select name={name} defaultValue="5">{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></Field>;
}
function SignInPrompt({ onClick }: { onClick: () => void }) {
  return <div className="empty-state"><ShoppingBag size={36}/><h3>Your market, all in one place</h3><p>Sign in to see your orders and delivery progress.</p><button className="primary-button" onClick={onClick}>Sign in <ArrowRight size={16}/></button></div>;
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} style={{ transform: "rotate(-40deg)" }}/>;
}
