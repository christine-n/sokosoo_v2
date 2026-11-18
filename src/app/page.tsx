"use client";

import { Fragment, Suspense, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownUp, ArrowLeft, ArrowRight, Carrot, Check, CheckCircle2, ChevronDown, ChevronRight,
  Bell, CircleHelp, Clock3, Egg, Heart, LayoutGrid, Leaf, LoaderCircle, MapPin,
  Milk, Minus, Package, Plus, Search, ShoppingBag, SlidersHorizontal,
  Sprout, Store, Tractor, Users, Wheat, X,
} from "lucide-react";
import { api, ApiError, label, money, type CartItem, type Enquiry, type Hub, type InboxSummary, type Listing, type ListingPage, type ProduceRequest, type SavedCartLine, type User } from "@/lib/api";
import { bagLifetime, groupBag, resolveBag } from "@/lib/bag";
import { changedQuantity, quantityStep, validQuantity } from "@/lib/quantity";
import { responsiveImage } from "@/lib/images";
import { consumerUrl, farmerUrl } from "@/lib/workspace";
import { connectionNotice, ConsumerWorkspace, Enquiries, EnquiryReview, FarmerWorkspace, Inbox, Inventory } from "./connections";
import { FeedbackContext, Field, focusFormError } from "./forms";
import { ListingPagination } from "./pagination";

const views = ["market", "requests", "hubs", "enquiries", "notifications", "saved", "farm", "consumer", "manage", "product", "cart", "checkout"] as const;
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
  const view: View = requestedView === "orders" ? "enquiries" : isView(requestedView) ? requestedView : "market";
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
    if (user?.role === "farmer" && ["farm", "enquiries", "notifications", "requests"].includes(next)) {
      return farmerUrl(next === "farm" ? "overview" : next, { ...(next === "enquiries" ? { direction: "sent" } : {}), ...params });
    }
    if (user?.role === "consumer" && ["consumer", "enquiries", "notifications", "requests"].includes(next)) {
      return consumerUrl(next === "consumer" ? "overview" : next, params);
    }
    return routeUrl(next, { q: query, requests_q: requestQuery, hubs_q: hubQuery, ...Object.fromEntries(filterKeys.map((key) => [key, searchParams.get(key) || ""])), area: searchParams.get("area") || "", produce_page: searchParams.get("produce_page") || "", ...params });
  }
  const setView = (next: View, params: Record<string, string> = {}) => router.push(viewUrl(next, { produce_page: "", ...params }));
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Listing[]>([]);
  const [productPage, setProductPage] = useState<Omit<ListingPage, "items">>({ count: 0, page: 1, pages: 1, next_page: null, previous_page: null });
  const producePage = searchParams.get("produce_page") || "1";
  const previousProducePage = useRef(producePage);
  const [bagError, setBagError] = useState("");
  const [bagRetry, setBagRetry] = useState(0);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [hubResults, setHubResults] = useState<Hub[]>([]);
  const [requests, setRequests] = useState<ProduceRequest[]>([]);
  const [searchStatus, setSearchStatus] = useState<"loading" | "ready" | "error">("loading");
  const [inventory, setInventory] = useState<Listing[]>([]);
  const [resources, setResources] = useState<Record<"session" | "hubs" | "products" | "inventory", LoadState>>({ session: initialLoad, hubs: initialLoad, products: initialLoad, inventory: initialLoad });
  const updateResource = useCallback((key: keyof typeof resources, status: LoadState["status"], error = "") => setResources((current) => ({ ...current, [key]: { status, error } })), []);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [bagReady, setBagReady] = useState(false);
  const [saved, setSaved] = useState<number[]>([]);
  const savedFilter = view === "saved" ? saved.join(",") : "";
  const [panel, setPanel] = useState<Panel>(null);
  const [detail, setDetail] = useState<Listing | null>(null);
  const [detailState, setDetailState] = useState<LoadState>(initialLoad);
  const [detailQuantity, setDetailQuantity] = useState("1");
  const category = searchParams.get("category") || "";
  const channel = searchParams.get("channel") || "";
  const hub = searchParams.get("hub") || "";
  const sort = searchParams.get("sort") || "recent";
  const maxPrice = searchParams.get("max_price") || "";
  const radius = searchParams.get("radius") || "";
  const setFilter = (key: string, value: string) => router.replace(viewUrl(view, { [key]: value, produce_page: "" }), { scroll: false });
  const [maxPriceDraft, setMaxPriceDraft] = useState(maxPrice);
  useEffect(() => setMaxPriceDraft(maxPrice), [maxPrice]);
  const [requestUnit, setRequestUnit] = useState("kg");
  const [listingUnit, setListingUnit] = useState("kg");
  const [listingCategory, setListingCategory] = useState("vegetables");
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
  const [notificationRefresh, setNotificationRefresh] = useState(0);
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [activeBid, setActiveBid] = useState<number | null>(null);
  const [inboxCount, setInboxCount] = useState(0);
  const [inboxLatestId, setInboxLatestId] = useState(0);
  const [inboxError, setInboxError] = useState("");
  const [cartSyncUser, setCartSyncUser] = useState<number | null>(null);
  const cartOwner = useRef<number | null>(null);
  cartOwner.current = user?.id ?? null;
  const cartWrites = useRef<Promise<unknown>>(Promise.resolve());
  const cartSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkoutKey = useRef<string>(crypto.randomUUID());
  const awardKey = useRef(crypto.randomUUID());
  const storageProblem = useRef(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const pageHeading = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const resumePanel = useRef<Panel>(null);

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".store-header");
    if (!header) return;
    const measure = () => {
      document.documentElement.style.setProperty("--header-height", `${getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height + 20 : 20}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
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
  useEffect(() => { setError(""); setFieldErrors({}); setValidationForm(null); }, [panel, activeBid]);
  useEffect(() => {
    let active = true;
    setBagError("");
    const load = async () => {
      try {
        const restored = await resolveBag(localStorage.getItem("sokosoo-bag-v1"));
        if (!active) return;
        setCart(restored.items);
        const key = localStorage.getItem("sokosoo-checkout-key-v1");
        if (key && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) checkoutKey.current = key;
        if (restored.adjusted) notify("Expired or unavailable items were removed from your private bag. No enquiry was sent.");
        setBagReady(true);
      } catch (cause) {
        if (active) setBagError(cause instanceof Error ? cause.message : "Your saved bag could not be loaded.");
      }
    };
    void load();
    return () => { active = false; };
  }, [bagRetry, notify]);
  useEffect(() => {
    if (view !== "product") return;
    let active = true;
    setDetail(null); setDetailState(initialLoad);
    api<Listing>(`listings/${productId}/`).then(data => {
      if (active) { setDetail(data); setDetailState({ status: "ready", error: "" }); }
    }).catch(cause => {
      if (!active) return;
      setDetailState(cause instanceof ApiError && cause.status === 404 ? { status: "ready", error: "" }
        : { status: "error", error: cause.message });
    });
    return () => { active = false; };
  }, [view, productId, refresh]);
  useEffect(() => {
    if (!bagReady) return;
    try {
      localStorage.setItem("sokosoo-bag-v1", JSON.stringify(cart.map((item) => ({ listingId: item.listing.id, quantity: item.quantity, expiresAt: item.expiresAt }))));
      localStorage.setItem("sokosoo-checkout-key-v1", checkoutKey.current);
    } catch (cause) {
      console.error("Bag persistence failed:", cause);
      if (!storageProblem.current) { storageProblem.current = true; setError("This browser cannot save your bag. Keep this tab open until you send your enquiry."); }
    }
  }, [cart, bagReady]);
  useEffect(() => {
    if (!bagReady) return;
    const timer = setInterval(() => {
      setCart(items => {
        const remaining = items.filter(item => item.expiresAt > Date.now());
        if (remaining.length !== items.length) {
          notify("Expired items were removed from your private bag. No enquiry was sent.");
          checkoutKey.current = crypto.randomUUID();
          return remaining;
        }
        return items;
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [bagReady, notify]);
  useEffect(() => {
    if (!user || !bagReady || cartSyncUser === user.id) return;
    let active = true;
    const owner = user.id;
    api<SavedCartLine[]>(`cart/?owner=${owner}`).then(async lines => {
      const restored = await resolveBag(JSON.stringify(lines.map(line => ({ listingId: line.listing_id, quantity: Number(line.quantity), expiresAt: new Date(line.expires_at).getTime() }))));
      if (!active) return;
      setCart(current => {
        const merged = new Map(current.map(item => [item.listing.id, item]));
        for (const item of restored.items) {
          const local = merged.get(item.listing.id);
          merged.set(item.listing.id, local ? { ...local, expiresAt: Math.min(local.expiresAt, item.expiresAt) } : item);
        }
        return [...merged.values()];
      });
      setCartSyncUser(owner);
    }).catch(cause => { if (active) setError(`Your account bag could not be loaded: ${cause.message}. Refresh to retry.`); });
    return () => { active = false; };
  }, [user?.id, bagReady, cartSyncUser]);
  useEffect(() => {
    if (!user || cartSyncUser !== user.id || !bagReady || busy) return;
    const owner = user.id;
    cartSaveTimer.current = setTimeout(() => {
      cartWrites.current = cartWrites.current.then(async () => {
        if (cartOwner.current !== owner) return;
        await api(`cart/?owner=${owner}`, "PUT", cart.map(item => ({ listing_id: item.listing.id, quantity: item.quantity, expires_at: new Date(item.expiresAt).toISOString() })));
      }).catch(cause => setError(`Your account bag could not be saved: ${cause.message}. Your local bag is retained.`));
    }, 400);
    return () => { if (cartSaveTimer.current !== null) clearTimeout(cartSaveTimer.current); };
  }, [cart, bagReady, user?.id, cartSyncUser, busy]);
  useEffect(() => {
    if (!user) { setInboxCount(0); setInboxLatestId(0); setInboxError(""); return; }
    let active = true;
    const load = () => api<InboxSummary>(`notifications/?summary=true&owner=${user.id}`).then(data => { if (active) { setInboxCount(data.unread); setInboxLatestId(data.latest_id); setInboxError(""); } })
      .catch(cause => { if (active) setInboxError(cause.message); });
    void load();
    const timer = setInterval(load, 60000);
    return () => { active = false; clearInterval(timer); };
  }, [user?.id, refresh, notificationRefresh]);
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
    updateResource("products", "loading");
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, category, channel, hub, sort, max_price: maxPrice, page: producePage });
      if (view === "saved") params.set("ids", savedFilter);
      if (place) { params.set("lat", String(place.lat)); params.set("lng", String(place.lng)); if (radius) params.set("radius", radius); }
      api<ListingPage>(`listings/?${params}`).then((data) => { if (active) { setProducts(data.items); setProductPage(data); updateResource("products", "ready"); } })
        .catch((cause: Error) => { if (active) { setProducts([]); updateResource("products", "error", cause.message); } })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [view, query, category, channel, hub, sort, maxPrice, producePage, place, radius, refresh, savedFilter, updateResource]);
  useEffect(() => {
    if (resources.products.status === "ready" && previousProducePage.current !== producePage) {
      const heading = document.querySelector<HTMLElement>("#produce h1, #produce h2");
      heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start", behavior: "instant" });
      previousProducePage.current = producePage;
    }
  }, [producePage, resources.products.status]);
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
    if (user?.role !== "farmer" || view !== "requests") return;
    let active = true;
    updateResource("inventory", "loading");
    const load = async () => {
      try {
        const items: Listing[] = [];
        let page: number | null = 1;
        while (page !== null && active) {
          const data: ListingPage = await api<ListingPage>(`listings/?mine=true&page=${page}`);
          items.push(...data.items);
          page = data.next_page;
        }
        if (active) { setInventory(items); updateResource("inventory", "ready"); }
      } catch (cause) { if (active) updateResource("inventory", "error", cause instanceof Error ? cause.message : "Could not load stock for offers."); }
    };
    void load();
    return () => { active = false; };
  }, [view, user?.id, user?.role, refresh, updateResource]);

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
      if (form?.isConnected) {
        const fields = cause instanceof ApiError ? cause.fields : {};
        setValidationForm(form);
        setFieldErrors(fields);
        focusFormError(form, fields);
      }
    }
    finally { setBusy(false); }
  }
  function addToCart(listing: Listing, quantity = 1) {
    if (busy) { setError("Please wait for the current action to finish before changing your bag."); return; }
    if (!bagReady) { setError("Please wait for your bag to load before adding produce."); return; }
    if (!validQuantity(listing.unit, quantity)) { setError(listing.unit === "head" ? "Enter a whole number of animals (head)." : "Enter a quantity greater than zero."); return; }
    const current = cart.find((item) => item.listing.id === listing.id)?.quantity || 0;
    if (!current && cart.length >= 100) { setError("Your bag can contain up to 100 products. Send an enquiry or remove an item before adding another."); return; }
    const next = Math.round((current + quantity) * 100) / 100;
    if (!validQuantity(listing.unit, next)) { setError("Adjust this animal quantity to a whole number using the controls in your bag."); return; }
    if (next > Number(listing.available)) { setError(`Only ${listing.available} ${listing.unit} is available, including what's already in your bag.`); return; }
    setCart((items) => items.some((item) => item.listing.id === listing.id)
      ? items.map((item) => item.listing.id === listing.id ? { ...item, listing, quantity: next } : item)
      : [...items, { listing, quantity, expiresAt: Math.min(Date.now() + bagLifetime, new Date(listing.available_until).getTime()) }]);
    checkoutKey.current = crypto.randomUUID();
    notify(`${listing.name} added to your bag`);
  }
  function updateQuantity(id: number, change: number) {
    if (busy) { setError("Please wait for the current action to finish before changing your bag."); return; }
    setCart((items) => items.map((item) => item.listing.id === id ? { ...item, quantity: changedQuantity(item.listing.unit, item.quantity, change, Number(item.listing.available)) } : item).filter((item) => item.quantity > 0));
    checkoutKey.current = crypto.randomUUID();
  }
  function needLogin(next: Panel) {
    if (user?.role === "consumer" && next === "request") { router.push(consumerUrl("new")); return; }
    if (!user) resumePanel.current = next;
    setPanel(user ? next : "login");
  }
  async function sendOfferEnquiry(id: number, contact: string, message: string) {
    if (cartSaveTimer.current !== null) clearTimeout(cartSaveTimer.current);
    await cartWrites.current;
    const enquiry = await api<Enquiry>(`bids/${id}/accept/`, "POST", { contact, message, key: awardKey.current });
    setCart(items => items.filter(item => !enquiry.items.some(sent => sent.listing_id === item.listing.id)));
    checkoutKey.current = crypto.randomUUID(); awardKey.current = crypto.randomUUID();
    setActiveBid(null); setView("enquiries", { enquiry: enquiry.id }); setRefresh(value => value + 1);
    notify("Your enquiry was sent to the farmer. Arrange next steps directly.");
  }
  const total = cart.reduce((sum, item) => sum + Number(item.listing.price) * item.quantity, 0);
  const count = cart.length;
  const cartGroups = groupBag(cart);
  const requestedOrigin = searchParams.get("origin");
  const checkoutGroup = requestedOrigin ? cartGroups.find((group) => group.key === requestedOrigin) : cartGroups.length === 1 ? cartGroups[0] : undefined;
  const farmerWorkspace = view === "farm" || user?.role === "farmer" && ["enquiries", "notifications", "requests"].includes(view);
  const consumerWorkspace = view === "consumer" || user?.role === "consumer" && ["enquiries", "notifications", "requests"].includes(view);
  const accountWorkspace = farmerWorkspace || consumerWorkspace;
  const workspace = accountWorkspace || view === "manage";
  const workspaceUrl = farmerWorkspace ? farmerUrl : consumerUrl;
  const shown = products;
  const groupByFarmer = Boolean(hub || channel === "hub");
  const displayProducts = groupByFarmer ? [...shown].sort((a, b) => a.farmer - b.farmer) : shown;
  const title = view === "saved" ? "Your saved finds" : query ? `Search results for “${query}”` : category ? categories.find((item) => item.id === category)?.name : hub ? hubs.find((item) => String(item.id) === hub)?.name : "Fresh from the farm";
  const showHero = view === "market" && !query && !category && !hub && !channel;
  const CatalogHeading = showHero ? "h2" : "h1";
  const nav = [{ id: "market" as const, label: "Shop produce" }, { id: "hubs" as const, label: "Shop by hub" }, { id: "requests" as const, label: "Requests & offers" }];
  const farmers = [...new Map(products.map((item) => [item.farmer, item])).values()];
  const offerStock = inventory.filter(item => item.state === "active" && new Date(item.available_until).getTime() > Date.now() && (item.channel === "direct" || item.received));
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
    <form className="price-filter" onSubmit={event => { event.preventDefault(); setFilter("max_price", maxPriceDraft); }}><Field title="Maximum unit price (KES)"><input aria-label="Maximum unit price (KES)" type="number" min="0" max="99999999.99" step=".01" placeholder="Any price" value={maxPriceDraft} onChange={event => setMaxPriceDraft(event.target.value)}/></Field><button className="secondary-button" type="submit">Apply price</button></form>
    <div className="filter-location"><span className="muted small">{place ? `Shopping near ${place.name}` : "Choose an area for distance filters."}</span><button className="text-button" onClick={() => setPanel("location")}><MapPin size={16}/>{place ? "Change location" : "Choose location"}</button>{place && <button className="text-button" onClick={() => { setPlace(null); setView(view, { area: "", radius: "", sort: sort === "distance" ? "" : sort }); }}>Clear location <X size={14}/></button>}</div>
    {place && <Field title="Distance"><select value={radius} onChange={(event) => setFilter("radius", event.target.value)}><option value="">Any distance</option><option value="5">Within 5 km</option><option value="20">Within 20 km</option><option value="50">Within 50 km</option></select></Field>}
  </div>;
  const bagFeedback = <ResourceFeedback name="your saved bag" state={{ status: bagError ? "error" : "loading", error: bagError }} retry={() => setBagRetry(value => value + 1)}/>;
  const requestForm = <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { const need = await api<ProduceRequest>("requests/", "POST", { ...values, hub: values.hub ? Number(values.hub) : null }); setPanel(null); setView("requests", { request: String(need.id) }); setRefresh((value) => value + 1); notify("Your request is open for farmer offers."); }); }}>
    <Field title="Request title"><input name="name" placeholder="e.g. Tomatoes for our community kitchen" required maxLength={120}/></Field>
    <Field title="Produce to match"><input name="product_name" placeholder="e.g. tomatoes" required maxLength={120}/></Field>
    <Field title="Category"><select name="category">{categories.slice(1).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field title="Hub availability alerts (optional)"><select name="hub" disabled={resources.hubs.status !== "ready"}><option value="">No hub alerts</option>{hubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p className="muted small">Choose a hub to receive in-app matches for the produce name, category, unit and full quantity. Alerts do not allocate stock.</p>
    <div className="form-columns"><Field title="Quantity"><input name="quantity" type="number" min={quantityStep(requestUnit)} step={quantityStep(requestUnit)} required/></Field><UnitField value={requestUnit} onChange={setRequestUnit}/></div><Field title="Total budget (KES)"><input name="budget" type="number" min=".01" step=".01" required/></Field><Field title="Your area"><input name="location" defaultValue={place?.name || ""} placeholder="e.g. Kilimani, Nairobi" required maxLength={120}/></Field><Field title="Receive offers until"><input type="date" name="deadline" min={today()} required/></Field><Field title="Anything else farmers should know?"><textarea name="notes" rows={3} placeholder="Ripeness, quality, quantity requirements..."/></Field><button className="primary-button full-width" disabled={busy}>{busy ? "Posting request..." : "Post request"} <ArrowRight size={17}/></button>
  </form>;
  const listingForm = <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api("listings/", "POST", { ...values, channel: "direct", hub: null, available_until: new Date(String(values.available_until)).toISOString() }); setPanel(null); router.push(farmerUrl("stock")); setRefresh((value) => value + 1); notify("Your farm produce is listed."); }); }}>
    <Field title="Produce name"><input name="name" required maxLength={120}/></Field><Field title="Category"><select name="category" value={listingCategory} onChange={event => { setListingCategory(event.target.value); if (event.target.value === "livestock") setListingUnit("head"); }}>{categories.slice(1).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <div className="form-columns"><Field title="Price per unit (KES)"><input name="price" type="number" step=".01" min=".01" max="99999999.99" required/></Field><UnitField value={listingUnit} onChange={setListingUnit}/></div>
    <Field title="Farm quantity"><input name="quantity" type="number" step={quantityStep(listingUnit)} min={quantityStep(listingUnit)} required/></Field>
    <Field title="Available until"><input name="available_until" type="datetime-local" required/></Field><p className="muted small">Your listing is hidden after this time until you confirm stock again. Dispatch stock to a hub from its batch details.</p>
    <Field title="Farm area"><input name="location" required placeholder="e.g. Limuru, Kiambu" maxLength={120}/></Field><FarmCoordinates/>
    <Field title={listingCategory === "livestock" ? "Farmer-recorded date" : "Harvest / production / slaughter date"}><input name="harvest_date" type="date" max={today()} required/></Field>{listingCategory === "livestock" && <p className="muted small">Enter the date you recorded this livestock stock. This is not a slaughter date.</p>}<Field title="Photo URL (optional)"><input name="image" type="url" placeholder="https://…"/></Field><Field title="Description"><textarea name="description" rows={3}/></Field>
    <button disabled={busy} className="primary-button full-width">{busy ? "Listing produce..." : "List produce"}<ArrowRight size={17}/></button>
  </form>;

  return <FeedbackContext.Provider value={{ error, notice, fields: fieldErrors, form: validationForm }}><div className="app-shell" onSubmitCapture={(event) => { if (event.target instanceof HTMLFormElement) submittedForm.current = event.target; }} onChangeCapture={(event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) {
      const name = event.target.name;
      if (fieldErrors[name]) setFieldErrors((current) => { const next = { ...current }; delete next[name]; return next; });
    }
  }}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`store-header${accountWorkspace ? " farmer-header" : ""}`}>
      {!accountWorkspace && <div className="utility-bar"><div><span>Good food. Fair connections.</span><button onClick={() => user?.role === "farmer" ? navigate("farm") : user?.role === "consumer" ? navigate("consumer") : setPanel("register")}><Tractor size={15}/>{user?.role === "farmer" ? "Farmer workspace" : user?.role === "consumer" ? "My workspace" : "Sell on SokoSoo"}</button><button onClick={() => setPanel("help")}>Help & support</button></div></div>}
      <div className={`retail-topbar${accountWorkspace ? " farmer-topbar" : ""}`}>
        <Link className="brand" href={accountWorkspace ? workspaceUrl() : "/"} aria-label={accountWorkspace ? "SokoSoo workspace overview" : "SokoSoo home"}><span className="brand-mark"><Sprout size={25}/></span>Soko<span>Soo</span><span className="brand-dot">.</span></Link>
        {accountWorkspace ? <span className="workspace-farm-name">{farmerWorkspace ? user?.farm_name || "Farmer workspace" : "My workspace"}</span> : <><form className="header-search search-field" role="search" aria-label={searchPlaceholder} onSubmit={(event) => { event.preventDefault(); router.push(viewUrl(searchScope, { [searchKey]: searchDraft.trim(), produce_page: "" }), { scroll: false }); }}>
          <Search size={20}/><input name="search" aria-label={searchPlaceholder} type="search" enterKeyHint="search" placeholder={searchPlaceholder} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}/><button type="submit" aria-label="Search"><ArrowRight size={19}/></button>
        </form>
        <button className="delivery-location" onClick={() => setPanel("location")}><MapPin size={20}/><span><small>Shopping near</small><strong>{place?.name || "Choose location"} <ChevronDown size={13}/></strong></span></button></>}
        <div className="header-actions">
          <details className="account-menu" ref={accountMenu}><summary aria-label={user ? `Account for ${user.name}` : "Your account"}><Users size={21}/><span>{user ? user.name.split(" ")[0] : "Account"}</span><ChevronDown size={13}/></summary><div className="account-popover">
            {user ? <p>Hi, {user.name.split(" ")[0]}<small>{label(user.role)} account</small></p> : <button className="primary-button" onClick={() => { accountMenu.current?.removeAttribute("open"); setPanel("login"); }}>Sign in / Register</button>}
            <Link href={accountWorkspace ? workspaceUrl("enquiries") : viewUrl("enquiries")} onClick={collapseAccount}><Package size={17}/> {farmerWorkspace ? "Buyer enquiries" : "My enquiries"}</Link>
            <Link href={accountWorkspace ? workspaceUrl("notifications") : viewUrl("notifications")} onClick={collapseAccount}><Bell size={17}/> Notifications{inboxCount > 0 ? ` (${inboxCount})` : ""}</Link>
            {!accountWorkspace && <Link href={viewUrl("saved")} onClick={collapseAccount}><Heart size={17}/> Saved produce</Link>}
            {accountWorkspace && <Link href="/" onClick={collapseAccount}><Store size={17}/> View marketplace</Link>}
            {user?.role === "consumer" && !consumerWorkspace && <Link href={consumerUrl()} onClick={collapseAccount}><LayoutGrid size={17}/> My workspace</Link>}
            {user?.role === "farmer" && !farmerWorkspace && <Link href={viewUrl("farm")} onClick={collapseAccount}><Tractor size={17}/> Farmer workspace</Link>}
            {user?.role === "manager" && <Link href={viewUrl("manage")} onClick={collapseAccount}><Store size={17}/> Hub workspace</Link>}
            <button onClick={() => { collapseAccount(); setPanel("help"); }}><CircleHelp size={17}/> Help & support</button>
            {user && <button disabled={busy} onClick={() => void action(async () => { if (cartSaveTimer.current !== null) clearTimeout(cartSaveTimer.current); await cartWrites.current; if (cartSyncUser === user.id) await api(`cart/?owner=${user.id}`, "PUT", cart.map(item => ({ listing_id: item.listing.id, quantity: item.quantity, expires_at: new Date(item.expiresAt).toISOString() }))); await api("logout/", "POST"); setUser(null); setInventory([]); setCartSyncUser(null); setActiveBid(null); navigate("market"); notify("You have signed out."); })}>Sign out</button>}
          </div></details>
          {user && <Link className="icon-button notification-bell" href={accountWorkspace ? workspaceUrl("notifications") : viewUrl("notifications")} aria-label={`Notifications, ${inboxCount} unread`}><Bell size={21}/>{inboxCount > 0 && <span className="bag-count">{inboxCount}</span>}</Link>}
          {!accountWorkspace && <><Link className="header-saved icon-button" href={viewUrl("saved")} aria-label="Saved produce"><Heart size={22}/></Link>
          <Link className="bag-button" href={viewUrl("cart")} aria-label={`Shopping bag, ${count} ${count === 1 ? "item" : "items"}`}><span className="bag-icon"><ShoppingBag size={23}/>{count > 0 && <span className="bag-count">{count}</span>}</span><span>Bag</span></Link></>}
        </div>
      </div>
      {!accountWorkspace && <div className="retail-navigation"><nav aria-label="Shopping navigation">{nav.map((item) => <Link key={item.id} href={viewUrl(item.id)} aria-current={view === item.id ? "page" : undefined}>{item.label}</Link>)}</nav>{view === "market" && <nav className="category-navigation" aria-label="Produce categories">{categories.slice(1).map((item) => <button key={item.id} aria-pressed={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => setView("market", { category: item.id, hub: "", channel: "", q: "" })}><item.icon size={16}/>{item.name}</button>)}</nav>}</div>}
    </header>

    <main id="main" ref={pageHeading} tabIndex={-1} className={accountWorkspace ? "operations-main farmer-main" : workspace ? "operations-main" : ""}>
      {workspace && !accountWorkspace && <nav className="workspace-nav" aria-label="Workspace navigation"><span><Store size={20}/> Hub workspace</span><Link href="/"><ArrowLeft size={15}/> Back to shopping</Link></nav>}
      {error && !panel && !activeBid && <div className="error-banner" role="alert"><CircleHelp size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={17}/></button></div>}
      {bagError && !accountWorkspace && view !== "cart" && view !== "checkout" && bagFeedback}
      {inboxError && <p className="error-banner" role="alert">Notification updates unavailable: {inboxError}. <button className="text-button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
      {resources.session.status === "error" && <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/>}
      {accountWorkspace && resources.hubs.status === "error" && <ResourceFeedback name="hubs" state={resources.hubs} retry={() => setRefresh(value => value + 1)}/>}
      {!accountWorkspace && <>
      {(view === "market" || view === "saved") && <>
        {showHero && <section className="hero">
          <div className="hero-content"><h1>Good food.<br/><span>Closer to home.</span></h1><p>Fresh produce from local farms and neighborhood hubs.</p><button className="primary-button" onClick={() => document.getElementById("produce")?.scrollIntoView()}>Shop the harvest <ArrowRight size={17}/></button><button className="hero-hub-link text-button" onClick={() => navigate("hubs")}>Explore hubs <ArrowRight size={16}/></button></div>
          <div className="hero-visual"><ProduceImage src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=85" alt="Fresh vegetables at a local produce market" sizes="(max-width: 700px) 40vw, 50vw" fetchPriority="high"/></div>
        </section>}
        <section id="produce" className="produce-section">
          <div className="section-heading"><div><CatalogHeading tabIndex={-1}>{title}</CatalogHeading><p>{view === "saved" ? "The produce you have your eye on. Saved for this visit." : "Choose your produce. Know your grower."}</p></div><button className="text-button" onClick={() => needLogin("request")}>Can't find it? Request it <ArrowRight size={15}/></button></div>
          <div className="catalog-toolbar"><div className="catalog-count" aria-live="polite">{loading ? "Finding produce…" : resources.products.status === "error" ? "Produce unavailable" : productPage.count > shown.length ? `Showing ${shown.length} of ${productPage.count} products` : `${shown.length} ${shown.length === 1 ? "product" : "products"}`}{place && ` near ${place.name}`}</div><button className="filter-trigger secondary-button" onClick={() => setPanel("filters")}><SlidersHorizontal size={17}/> Filters{[channel, hub, maxPrice, radius].filter(Boolean).length > 0 && <span>{[channel, hub, maxPrice, radius].filter(Boolean).length}</span>}</button><label className="sort-control"><ArrowDownUp size={16}/><select aria-label="Sort produce" value={sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="recent">Newest first</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>{place && <option value="distance">Nearest first</option>}</select></label></div>
          {resources.products.status === "error" && producePage !== "1" && <Link className="text-button" href={viewUrl(view, { produce_page: "" })}>Return to the first page <ArrowRight size={16}/></Link>}
          {(category || query || channel || hub || maxPrice || radius) && <div className="active-filters"><span>{[categories.find((item) => item.id === category && category)?.name, query && `Search: ${query}`, channel && (channel === "hub" ? "Hub produce" : "Farm direct"), hub && hubs.find((item) => String(item.id) === hub)?.name, maxPrice && `Up to ${money(maxPrice)}`, radius && place && `Within ${radius} km`, radius && !place && "Choose your location to apply distance"].filter(Boolean).join(" · ")}</span><button className="text-button" onClick={() => setView(view, { ...emptyFilters, q: "" })}>Clear filters <X size={14}/></button></div>}
          {resources.products.status !== "ready" ? <ResourceFeedback name="produce" state={resources.products} retry={() => setRefresh((value) => value + 1)}/> : shown.length ? <div className="product-grid">{displayProducts.map((product, index) => {
            const bagQuantity = cart.find(item => item.listing.id === product.id)?.quantity ?? 0;
            return <Fragment key={product.id}>{groupByFarmer && (index === 0 || displayProducts[index - 1].farmer !== product.farmer) && <h3 className="farmer-group-title"><Sprout size={19}/>{product.farm_name || product.farmer_name}<span>Produce from {product.farmer_name}</span></h3>}<article className="product-card">
            <div className="product-image"><Link className="image-link" aria-label={`View ${product.name}`} href={viewUrl("product", { id: String(product.id) })}><ProduceImage src={product.image} alt={product.name} sizes="(max-width: 700px) calc((100vw - 49px) / 2), (max-width: 960px) 30vw, (max-width: 1440px) 23vw, 322px" loading="lazy"/></Link><span className={`source-badge ${product.channel}`}>{product.channel === "direct" ? "Farm direct" : "At a hub"}</span><button className={`save-button ${saved.includes(product.id) ? "is-saved" : ""}`} aria-label={`${saved.includes(product.id) ? "Unsave" : "Save"} ${product.name}`} aria-pressed={saved.includes(product.id)} onClick={() => {
              setSaved((items) => items.includes(product.id) ? items.filter((id) => id !== product.id) : [...items, product.id]);
              if (view === "saved" && products.length === 1 && producePage !== "1") setView("saved", { produce_page: String(Math.max(1, Number(producePage) - 1)) });
            }}><Heart size={19} fill={saved.includes(product.id) ? "currentColor" : "none"}/></button></div>
            <div className="product-info"><div className="farm-line"><Sprout size={14}/>{product.farm_name || product.farmer_name}</div><Link className="product-title" href={viewUrl("product", { id: String(product.id) })}>{product.name}</Link><div className="product-location"><MapPin size={13}/>{product.location}{product.distance !== undefined && <span> · {product.distance} km</span>}</div><div className="product-bottom"><div><strong>{money(product.price)}</strong><span> / {product.unit}</span></div>{bagQuantity > 0 ? <div className="quantity-control product-bag-control" role="group" aria-label={`${product.name} in your bag`}>
              <button disabled={!bagReady || busy} aria-label={`Reduce ${product.name} quantity`} onClick={() => updateQuantity(product.id, -1)}><Minus size={17}/></button>
              <output aria-live="polite">{bagQuantity} {product.unit} in bag</output>
              <button disabled={!bagReady || busy || bagQuantity >= Number(product.available)} aria-label={`Increase ${product.name} quantity`} onClick={() => addToCart(product, Math.min(1, Number(product.available) - bagQuantity))}><Plus size={17}/></button>
            </div> : <button className="add-button" disabled={!bagReady || busy} onClick={() => addToCart(product)} aria-label={`Add ${product.name} to bag`}><Plus size={17}/><span>Add to bag</span></button>}</div><div className="stock-note">{Number(product.available).toLocaleString()} {product.unit} available</div></div>
          </article></Fragment>;
          })}</div> : <div className="empty-state"><Sprout size={36}/><h3>{view === "saved" ? "Your next favorite is out there" : "No produce matches just yet"}</h3><p>{view === "saved" ? "Tap the heart on a product to keep it here." : "Try another filter, or ask local farmers for what you need."}</p><button className="secondary-button" onClick={() => setView("market", { ...emptyFilters, q: "" })}>Explore all produce <ArrowRight size={16}/></button></div>}
          {resources.products.status === "ready" && <ListingPagination data={productPage} label="Produce pages" href={page => viewUrl(view, { produce_page: String(page) })}/>}
        </section>
        <section className="request-banner"><span className="request-icon"><ShoppingBag size={25}/></span><div><h3>Your shopping list. Their next harvest.</h3><p>Tell local farmers what you need and compare their offers.</p></div><button className="secondary-button" onClick={() => needLogin("request")}>Create an order request <ArrowRight size={16}/></button></section>
        {view === "market" && <><section className="discovery-section"><div className="section-heading"><div><h2>Shop a little closer.</h2><p>Confirmed hub produce, still connected to its farmer.</p></div><Link className="text-button" href={viewUrl("hubs")}>Explore all hubs <ArrowRight size={16}/></Link></div>{resources.hubs.status !== "ready" && <ResourceFeedback name="hubs" state={resources.hubs} retry={() => setRefresh((value) => value + 1)}/>}<div className="hub-shopping-list">{hubs.map((item) => <button key={item.id} onClick={() => { setView("market", { ...emptyFilters, q: "", channel: "hub", hub: String(item.id) }); document.getElementById("produce")?.scrollIntoView(); }}><Store size={29}/><span><strong>{item.name}</strong><small><MapPin size={13}/>{item.location}</small></span><ArrowRight size={20}/></button>)}</div></section>
        <section className="discovery-section"><div className="section-heading"><div><h2>Good food has a grower.</h2><p>Meet the growers behind your produce.</p></div></div>{resources.products.status !== "ready" ? <ResourceFeedback name="growers" state={resources.products} retry={() => setRefresh((value) => value + 1)}/> : <div className="farmer-shopping-list">{farmers.map((farmer) => <article key={farmer.farmer}><div className="farmer-portrait"><ProduceImage src={farmer.image} alt={`Produce from ${farmer.farm_name || farmer.farmer_name}`} sizes="120px" loading="lazy"/></div><div><h3>{farmer.farm_name || farmer.farmer_name}</h3><p>Grown by {farmer.farmer_name}</p><button className="text-button" onClick={() => { setView("market", { ...emptyFilters, q: farmer.farm_name || farmer.farmer_name }); document.getElementById("produce")?.scrollIntoView(); }}>Shop this farm <ArrowRight size={16}/></button></div></article>)}</div>}</section>
        <section className="trust-strip" aria-label="Ways to shop"><div><Sprout/><span><strong>Direct from the farm</strong><small>Choose produce from a named grower</small></span></div><div><Store/><span><strong>Collected at a hub</strong><small>Hub receipt confirmed before sale</small></span></div><div><ShoppingBag/><span><strong>Your request, their offer</strong><small>Compare bids for what you need</small></span></div></section></>}
      </>}

      {view === "product" && <section className="shopping-page">
        <Link className="back-link" href={viewUrl("market")}><ArrowLeft size={17}/> Back to produce</Link>
        {detailState.status !== "ready" ? <ResourceFeedback name="produce" state={detailState} retry={() => setRefresh(value => value + 1)}/> : detail ? <>
          <div className="product-detail-page"><ProduceImage className="detail-image" src={detail.image} alt={detail.name} sizes="(max-width: 700px) 100vw, (max-width: 1440px) 50vw, 645px" fetchPriority="high"/>
            <div className="detail-content"><span className="status-pill green">{detail.channel === "hub" ? "Confirmed at hub" : "Direct from farm"}</span><h1>{detail.name}</h1><p className="detail-farmer"><Sprout size={18}/>{detail.farm_name || detail.farmer_name}</p><p className="detail-description">{detail.description}</p>
              <div className="detail-price">{money(detail.price)} <span>/ {detail.unit}</span></div>
              <p className="stock-note">{Number(detail.available).toLocaleString()} {detail.unit} available</p>
              <form className="detail-purchase" onSubmit={(event) => { event.preventDefault(); addToCart(detail, Number(detailQuantity)); }}><Field title={`Quantity (${detail.unit})`}><input type="number" inputMode={detail.unit === "head" ? "numeric" : "decimal"} min={quantityStep(detail.unit)} max={detail.available} step={quantityStep(detail.unit)} required value={detailQuantity} onChange={(event) => setDetailQuantity(event.target.value)}/></Field><button className="primary-button" disabled={!bagReady || busy}><ShoppingBag size={18}/> Add to bag</button></form>
              <Link className="text-button" href={viewUrl("cart")}>View your bag <ArrowRight size={16}/></Link>
              <dl className="detail-facts"><div><dt>Farmer</dt><dd>{detail.farmer_name}</dd></div><div><dt>Pickup origin</dt><dd>{detail.channel === "hub" ? detail.hub_name : detail.location}</dd></div><div><dt>{detail.category === "livestock" ? "Farmer-recorded date" : "Harvest / production date"}</dt><dd>{new Date(`${detail.harvest_date}T12:00:00`).toLocaleDateString("en-KE")}</dd></div></dl>
              <p className="muted small">Saving to your bag does not notify the farmer. Stock is checked when you send an enquiry. {connectionNotice}</p>
            </div>
          </div>
        </> : <div className="empty-state"><Sprout size={36}/><h1>This produce is no longer available.</h1><p>Browse the current harvest to find something else.</p><Link className="primary-button" href="/">Shop produce <ArrowRight size={16}/></Link></div>}
      </section>}

      {view === "cart" && <section className="shopping-page">
        <Link className="back-link" href="/"><ArrowLeft size={17}/> Continue shopping</Link><div className="section-heading"><div><h1>Your market bag</h1><p>{count} {count === 1 ? "product" : "products"} picked for your table.</p></div></div>
        {!bagReady ? bagFeedback : cart.length ? <div className="shopping-columns"><div>
          <div className="notice-inline"><Store size={20}/> Your bag is private and does not reserve stock. Items leave after 24 hours. Send a separate enquiry for each farmer and origin.</div>
          {cartGroups.map((group) => <section className="bag-group" key={group.key}><header><div><h2>{group.farmer}</h2><p><MapPin size={15}/>{group.pickup} · {group.items[0].listing.channel === "hub" ? "Hub pickup" : "Farm pickup"}</p></div><Sprout size={23}/></header>
            <BagItems items={group.items} updateQuantity={updateQuantity} busy={busy}/>
            <div className="bag-group-footer"><span>Indicative subtotal <strong>{money(group.total)}</strong></span><Link className="primary-button" href={viewUrl("checkout", { origin: group.key })}>Review enquiry <ArrowRight size={17}/></Link></div>
          </section>)}
        </div><aside className="order-summary" aria-label="Bag summary"><h2>Bag summary</h2><div className="summary-line"><span>Indicative produce subtotal</span><strong>{money(total)}</strong></div><div className="summary-line"><span>Farm / hub origins</span><strong>{cartGroups.length}</strong></div><p>{connectionNotice}</p><div className="notice-inline"><CircleHelp size={18}/><span>Only sending an enquiry deducts availability and notifies the farmer.</span></div><Link className="text-button" href="/">Add more produce <ArrowRight size={16}/></Link></aside></div> : <EmptyBag/>}
      </section>}

      {view === "checkout" && <section className="shopping-page">
        <Link className="back-link" href={viewUrl("cart")}><ArrowLeft size={17}/> Back to your bag</Link><div className="section-heading"><div><h1>Review your enquiry</h1><p>Check your quantities, then connect with the farmer.</p></div></div>
        {!bagReady ? bagFeedback : !cart.length ? <EmptyBag/> : !checkoutGroup ? <div className="empty-state"><Store size={35}/><h2>Choose a farmer and origin.</h2><p>Each enquiry is for one farmer at one farm or hub.</p><Link className="primary-button" href={viewUrl("cart")}>Choose from your bag <ArrowRight size={16}/></Link></div> : <div className="shopping-columns">
          <div className="checkout-content"><section className="checkout-section"><h2>Your produce</h2><p><strong>{checkoutGroup.farmer}</strong> · {checkoutGroup.pickup}</p><BagItems items={checkoutGroup.items}/><Link className="text-button" href={viewUrl("cart")}>Edit bag <ArrowRight size={15}/></Link></section>
          {resources.session.status !== "ready" ? <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh(value => value + 1)}/> : <EnquiryReview user={user} items={checkoutGroup.items} signIn={() => setPanel("login")} onSend={async (contact, message) => {
            const submittedItems = checkoutGroup.items;
            if (submittedItems.some(item => item.expiresAt <= Date.now())) throw new Error("An item expired in your private bag. Return to your bag and add it again if available.");
            setBusy(true);
            if (cartSaveTimer.current !== null) clearTimeout(cartSaveTimer.current);
            try {
              await cartWrites.current;
              await api("enquiries/", "POST", { contact, message, key: checkoutKey.current, items: submittedItems.map(item => ({ listing: item.listing.id, quantity: item.quantity })) });
              setCart(items => items.filter(item => !submittedItems.some(submitted => submitted.listing.id === item.listing.id)));
              checkoutKey.current = crypto.randomUUID(); setView("enquiries"); setRefresh(value => value + 1);
              notify("Your enquiry was sent to the farmer. Arrange payment and logistics directly.");
            } finally { setBusy(false); }
          }}/>}</div>
          <aside className="order-summary" aria-label="Enquiry summary"><h2>Enquiry summary</h2><div className="summary-line"><span>{checkoutGroup.items.length} products</span><strong>{money(checkoutGroup.total)}</strong></div><p>Indicative produce total, not a payment request. Current stock is checked on submission.</p><p>No platform payment or delivery booking.</p></aside>
        </div>}
      </section>}

      {view === "requests" && <section className="workspace"><div className="section-heading"><div><h1>Good food starts with a request.</h1><p>Tell farmers what you need. Let the right harvest find you.</p></div><button className="primary-button" onClick={() => needLogin("request")}><Plus size={17}/> Post a request</button></div><div className="notice-inline"><ShoppingBag size={19}/> Farmers offer a unit price for your full quantity. Choose an offer to send a stock-checked enquiry, not a payment or delivery booking.</div>{searchSummary}{searchStatus !== "ready" ? searchFeedback : <><div className="request-list">{requests.map((need) => <article className="request-card" key={need.id}><div className="request-card-top"><span className={`status-pill ${need.status === "open" ? "green" : ""}`}>{need.deadline < today() && need.status === "open" ? "expired" : label(need.status)}</span><small><Clock3 size={13}/> Until {new Date(`${need.deadline}T12:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</small></div><h2>{need.name}</h2><p>{need.notes}</p><div className="request-facts"><strong>{Number(need.quantity)} {need.unit}</strong><span>Budget {money(need.budget)}</span><span><MapPin size={14}/>{need.location}</span></div>{need.hub_matches?.length > 0 && <div className="notice-inline"><Store size={18}/><span>Matching produce at your selected hub: {need.hub_matches.map(match => <Link key={match.id} href={viewUrl("product", { id: String(match.id) })}>{match.name} <ArrowRight size={14}/></Link>)}. Availability is rechecked when you enquire.</span></div>}<div className="request-card-footer"><span>Requested by {need.consumer_name || "a local buyer"}</span><strong>{need.bids.length} {need.bids.length === 1 ? "offer" : "offers"}</strong></div>
        {need.is_owner && need.bids.map((bid) => <div className="bid-row" key={bid.id}><div><strong>{bid.farm_name || bid.farmer_name}</strong><p>{bid.message || bid.listing_name}</p><span>{money(bid.price)} / {need.unit} · Total {money(Number(bid.price) * Number(need.quantity))}</span></div>{need.status === "open" && <button disabled={busy} className="secondary-button" onClick={() => { setActiveBid(bid.id); }}>Accept offer <ArrowRight size={15}/></button>}</div>)}
        {user?.role === "farmer" && !need.is_owner && need.status === "open" && need.deadline >= today() && (resources.inventory.status !== "ready" ? <ResourceFeedback name="stock for offers" state={resources.inventory} retry={() => setRefresh((value) => value + 1)}/> : offerStock.some(item => item.unit === need.unit && Number(item.available) >= Number(need.quantity)) ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { await api(`requests/${need.id}/bids/`, "POST", values); notify("Your offer has been sent."); setRefresh((value) => value + 1); }); }}><Field title="Your produce"><select name="listing" required defaultValue=""><option value="" disabled>Choose your stock</option>{offerStock.filter(item => item.unit === need.unit && Number(item.available) >= Number(need.quantity)).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.available} {item.unit})</option>)}</select></Field><Field title={`Price per ${need.unit} (KES)`}><input name="price" type="number" step=".01" min=".01" required/></Field><Field title="Message"><input name="message" maxLength={400} placeholder="What makes your produce a good fit?"/></Field><button className="primary-button" disabled={busy}>Send offer</button></form> : <p className="notice-inline">No active stock covers this request's full quantity and unit. Add or reconfirm suitable stock before offering.</p>)}
      </article>)}</div>{!requests.length && <div className="empty-state"><ShoppingBag size={35}/><h2>{requestQuery ? "No requests match your search" : "Be the first to ask"}</h2><p>{requestQuery ? "Try another produce name, description or location, or clear your search." : "Post a request and connect with local growers."}</p></div>}</>}</section>}

      {view === "hubs" && <section className="workspace"><div className="section-heading"><div><h1>Your neighborhood harvest.</h1><p>Discover local aggregation hubs. Every product stays connected to its farmer.</p></div></div>{searchSummary}{searchStatus !== "ready" ? searchFeedback : hubResults.length ? <div className="hub-grid">{hubResults.map((item) => <article className="hub-card" key={item.id}><div className="hub-content"><Store size={28} aria-hidden="true"/><h2>{item.name}</h2><p><MapPin size={16}/>{item.location}</p><p>Browse produce received and confirmed by the hub manager, with each farmer clearly identified.</p><button className="secondary-button" onClick={() => setView("market", { ...emptyFilters, q: "", channel: "hub", hub: String(item.id) })}>Shop this hub <ArrowRight size={16}/></button><a href={`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`} target="_blank" rel="noreferrer">View location <ArrowUpRightIcon/></a></div></article>)}</div> : <div className="empty-state"><Store size={35}/><h2>{hubQuery ? "No hubs match your search" : "No hubs available yet"}</h2><p>{hubQuery ? "Try another hub name or location, or clear your search." : "Check back soon for local aggregation hubs."}</p></div>}</section>}

      {(view === "enquiries" || view === "notifications") && (resources.session.status === "loading" ? <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh(value => value + 1)}/> : !user ? <SignInPrompt onClick={() => setPanel("login")}/> : view === "enquiries" ? <Enquiries user={user} version={refresh} updated={() => setRefresh(value => value + 1)} focusId={searchParams.get("enquiry")}/> : <Inbox key={`${user.id}:${searchParams.toString()}`} user={user} version={refresh + notificationRefresh} latestId={inboxLatestId} unreadCount={inboxCount} updated={() => setNotificationRefresh(value => value + 1)}/>)}
      {view === "manage" && user?.role === "manager" && <Inventory user={user} hubs={hubs} version={refresh} updated={() => setRefresh(value => value + 1)} addProduce={() => {}} hubMode/>}
      </>}
      {farmerWorkspace && user?.role === "farmer" && <FarmerWorkspace user={user} hubs={hubs} version={refresh} updated={() => setRefresh(value => value + 1)} notificationVersion={refresh + notificationRefresh} notificationUpdated={() => setNotificationRefresh(value => value + 1)} latestId={inboxLatestId} unreadCount={inboxCount} listingForm={listingForm}/>}
      {consumerWorkspace && user?.role === "consumer" && <ConsumerWorkspace user={user} version={refresh} updated={() => setRefresh(value => value + 1)} notificationVersion={refresh + notificationRefresh} notificationUpdated={() => setNotificationRefresh(value => value + 1)} latestId={inboxLatestId} unreadCount={inboxCount} requestForm={requestForm} acceptOffer={async (id, contact, message) => {
        if (busy) throw new Error("Please wait for the current action to finish.");
        setBusy(true);
        try { await sendOfferEnquiry(id, contact, message); } finally { setBusy(false); }
      }}/>}
      {workspace && resources.session.status === "loading" && <ResourceFeedback name="account" state={resources.session} retry={() => setSessionRefresh((value) => value + 1)}/>}
      {workspace && resources.session.status === "ready" && (farmerWorkspace ? user?.role !== "farmer" : consumerWorkspace ? user?.role !== "consumer" : user?.role !== "manager") && <section className="workspace"><div className="empty-state"><Store size={36}/><h1>{user ? "This workspace needs a different account." : "Sign in to your workspace."}</h1><p>{user ? `Use a ${farmerWorkspace ? "farmer" : consumerWorkspace ? "consumer" : "hub manager"} account to manage this workspace.` : "Your shopping bag will stay here while you sign in."}</p>{!user && <button className="primary-button" onClick={() => setPanel("login")}>Sign in <ArrowRight size={16}/></button>}</div></section>}
      {!accountWorkspace && <footer className="page-footer"><span className="footer-brand"><Sprout size={16}/> SokoSoo</span><span>Good food. Fair connections.</span></footer>}
    </main>

    {notice && <div className="toast" role="status"><CheckCircle2 size={19}/><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16}/></button></div>}

    {(panel === "login" || panel === "register") && <Drawer title={panel === "login" ? "Welcome to SokoSoo" : "Your local market awaits"} close={() => { setPanel(null); resumePanel.current = null; }}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = formValues(event); void action(async () => { const result = await api<{ user: User }>(`${panel}/`, "POST", data); setUser(result.user); if (resumePanel.current === "request" && result.user.role === "consumer") { setPanel(null); router.push(consumerUrl("new")); } else setPanel(resumePanel.current); resumePanel.current = null; setRefresh((value) => value + 1); notify(`Welcome, ${result.user.name.split(" ")[0]}!`); }); }}>
      {panel === "register" && <><Field title="Full name"><input name="name" autoComplete="name" required maxLength={100}/></Field><Field title="Email address"><input name="email" type="email" autoComplete="email" required/></Field></>}
      <Field title="Username"><input name="username" autoComplete="username" autoCapitalize="none" required maxLength={150}/></Field><Field title="Password"><input name="password" type="password" autoComplete={panel === "login" ? "current-password" : "new-password"} required minLength={panel === "register" ? 8 : undefined}/></Field>
      {panel === "register" && <><Field title="I'm joining as"><select name="role"><option value="consumer">A consumer — I want to shop</option><option value="farmer">A farmer — I want to sell</option></select></Field><Field title="Farm name (if you're a farmer)"><input name="farm_name" maxLength={120}/></Field></>}
      <button className="primary-button full-width" disabled={busy}>{busy ? <><LoaderCircle className="spinner" size={18} aria-hidden="true"/>{panel === "login" ? "Signing in..." : "Creating account..."}</> : panel === "login" ? "Sign in" : "Create account"}<ArrowRight size={17}/></button></form><p className="auth-switch">{panel === "login" ? "New to SokoSoo?" : "Already have an account?"} <button className="text-button" onClick={() => { setPanel(panel === "login" ? "register" : "login"); setError(""); }}>{panel === "login" ? "Join SokoSoo" : "Sign in"}</button></p></Drawer>}

    {panel === "filters" && <Drawer title="Find your produce" close={() => setPanel(null)}>{filters}<button className="primary-button full-width" disabled={loading} onClick={() => setPanel(null)}>{loading ? "Finding produce..." : `Show ${productPage.count} products`} <ArrowRight size={17}/></button></Drawer>}

    {panel === "request" && <Drawer title="What's on your shopping list?" close={() => setPanel(null)}>{requestForm}</Drawer>}

    {panel === "listing" && <Drawer title="Add produce" close={() => setPanel(null)}>{listingForm}</Drawer>}

    {panel === "location" && <Drawer title="Bring your market closer" close={() => setPanel(null)}><p className="drawer-intro">Choose an area to find nearby farms and hubs. Distances are straight-line estimates. GPS is used only for this visit.</p><button className="secondary-button full-width" disabled={busy} onClick={() => { if (!navigator.geolocation) { setError("Location is unavailable. Select an area below."); return; } setBusy(true); navigator.geolocation.getCurrentPosition((position) => { setPlace({ name: "your location", lat: position.coords.latitude, lng: position.coords.longitude }); setFilter("area", ""); setBusy(false); setPanel(null); notify("Location updated. You can now filter by distance."); }, () => { setBusy(false); setError("Location permission was denied or GPS is unavailable. Choose an area below."); }, { timeout: 15000 }); }}><MapPin size={17}/>{busy ? "Finding your location…" : "Use my current location"}</button><h3 className="workspace-subtitle">Or choose an area</h3>{areas.map((area) => <button key={area.id} className="location-choice" onClick={() => { setPlace(null); setFilter("area", area.id); setPanel(null); }}><MapPin size={18}/>{area.name}<ChevronRight size={16}/></button>)}{place && <button className="text-button" onClick={() => { setPlace(null); setView(view, { area: "", radius: "", sort: sort === "distance" ? "" : sort }); setPanel(null); }}>Clear location <X size={15}/></button>}</Drawer>}

    {panel === "help" && <Drawer title="A helping hand" close={() => setPanel(null)}><div className="help-content"><h3>Connect with your grower</h3><p>Save produce privately, send a stock-checked enquiry, or post a request and compare farmer offers.</p><h3>Payment and logistics</h3><p>{connectionNotice}</p><h3>Your notifications</h3><p>Open Notifications for replies, stock updates and reminders.</p><h3>Stock at a hub</h3><p>Managers confirm receipt before produce becomes available. Farmers can follow hub stock from their inventory.</p></div></Drawer>}

    {activeBid && <Drawer title="Enquire about this offer" close={() => setActiveBid(null)}><p className="drawer-intro">{connectionNotice} We recheck stock and deduct availability when your enquiry is sent.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const values = formValues(event); void action(async () => { if (activeBid === null) throw new Error("Choose a farmer offer first."); await sendOfferEnquiry(activeBid, String(values.contact), String(values.message)); }); }}><Field title="Your phone number or email"><input name="contact" maxLength={200} required/></Field><Field title="Message (optional)"><textarea name="message" maxLength={1000} rows={3}/></Field><button className="primary-button full-width" disabled={busy}>Send stock-checked enquiry <ArrowRight size={17}/></button></form></Drawer>}
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
  return <div className="empty-state"><CircleHelp size={35} aria-hidden="true"/><h2>Could not load {name}</h2><p role="alert">{state.error}</p><button className="secondary-button" onClick={retry}>Retry {name} <ArrowRight size={16}/></button></div>;
}
function ProduceImage({ src, sizes = "100vw", alt, ...props }: ComponentProps<"img"> & { src?: string }) {
  const source = src || "/icon.svg";
  return <img {...props} src={source} alt={alt} {...responsiveImage(source, sizes)} decoding="async"/>;
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
function UnitField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Field title="Unit"><select name="unit" value={value} onChange={event => onChange(event.target.value)}><option value="kg">Kilograms (kg)</option><option value="litre">Litres</option><option value="tray">Trays</option><option value="head">Head (whole animals)</option><option value="piece">Pieces</option></select></Field>;
}
function SignInPrompt({ onClick }: { onClick: () => void }) {
  return <div className="empty-state"><ShoppingBag size={36}/><h3>Your market, all in one place</h3><p>Sign in to see your enquiries and notifications.</p><button className="primary-button" onClick={onClick}>Sign in <ArrowRight size={16}/></button></div>;
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} style={{ transform: "rotate(-40deg)" }}/>;
}
