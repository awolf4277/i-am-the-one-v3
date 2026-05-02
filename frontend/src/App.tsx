import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./App.css";
import ProductImage from "./components/ProductImage";

type HealthResponse = {
  ok: boolean;
  app: string;
  system: string;
  owner: string;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  image_url: string;
};

type ProductsResponse = {
  ok: boolean;
  capacity?: number;
  products: Product[];
};

type CartLine = {
  product_id: string;
  qty: number;
};

type CustomerInfo = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

type CheckoutResponse = {
  ok: boolean;
  error?: string;
  order?: {
    id: string;
    status: string;
    total_cents: number;
    upload_token?: string;
    customer?: CustomerInfo;
  };
  products?: Product[];
};

type Order = {
  id: string;
  created_at: string;
  status: string;
  total_cents: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  shipping_city?: string;
  shipping_state?: string;
};

type OrderDetailOrder = {
  id: string;
  created_at: string;
  status: string;
  total_cents: number;
  upload_token: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  order_notes: string;
};

type OrderDetailItem = {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

type OrderUpload = {
  id: string;
  order_id: string;
  original_filename: string;
  stored_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

type OrderDetail = {
  order: OrderDetailOrder;
  items: OrderDetailItem[];
  uploads: OrderUpload[];
};

type OrdersResponse = {
  ok: boolean;
  orders: Order[];
};

type OrderDetailResponse = {
  ok: boolean;
  error?: string;
  order?: OrderDetailOrder;
  items?: OrderDetailItem[];
  uploads?: OrderUpload[];
};

type AdminLoginResponse = {
  ok: boolean;
  token?: string;
  error?: string;
};

type CompletedOrder = {
  id: string;
  total_cents: number;
  upload_token: string;
  customer?: CustomerInfo;
};

type BuyerUploadResponse = {
  ok: boolean;
  error?: string;
  upload?: {
    id: string;
    order_id: string;
    original_filename: string;
    stored_filename: string;
    content_type: string;
    size_bytes: number;
  };
};

type SortMode = "featured" | "name" | "price-low" | "price-high" | "stock-high";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:5000").replace(/\/$/, "");
const ADMIN_TOKEN_KEY = "iato_owner_admin_token";

const EMPTY_CUSTOMER: CustomerInfo = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
};

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function shortDate(value: string) {
  if (!value) return "New";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fileSizeLabel(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function customerStockLabel(stock: number) {
  if (stock <= 0) return "Sold Out";
  if (stock <= 5) return "Limited";
  return "Available";
}

function clampCartToProducts(cart: Record<string, number>, sourceProducts: Product[]) {
  const next: Record<string, number> = {};

  for (const [productId, qty] of Object.entries(cart)) {
    const product = sourceProducts.find((item) => item.id === productId);
    if (!product) continue;

    const safeQty = Math.min(qty, product.stock);

    if (safeQty > 0) {
      next[productId] = safeQty;
    }
  }

  return next;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [capacity, setCapacity] = useState(100);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [orderDetailBusy, setOrderDetailBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("featured");
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);
  const [buyerUploadFile, setBuyerUploadFile] = useState<File | null>(null);
  const [buyerUploadStatus, setBuyerUploadStatus] = useState("");
  const [buyerUploadBusy, setBuyerUploadBusy] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(EMPTY_CUSTOMER);

  const rawViewMode = new URLSearchParams(window.location.search).get("view");

  const viewMode =
    rawViewMode === "owner" || rawViewMode === "operator"
      ? rawViewMode
      : "customer";

  const wantsAdminView = viewMode === "owner" || viewMode === "operator";
  const hasAdminAccess = wantsAdminView && Boolean(adminToken);

  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(products.map((p) => p.category))).sort()];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        product.description.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q);

      return matchesCategory && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      if (sortMode === "price-low") return a.price_cents - b.price_cents;
      if (sortMode === "price-high") return b.price_cents - a.price_cents;
      if (sortMode === "stock-high") return b.stock - a.stock;
      return a.sku.localeCompare(b.sku);
    });
  }, [products, query, category, sortMode]);

  const spotlight = useMemo(() => {
    return (
      products.find((p) => p.id === "iato-launch") ||
      products.find((p) => p.id === "wolf-pro") ||
      products[0]
    );
  }, [products]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .map(([product_id, qty]) => {
        const product = products.find((p) => p.id === product_id);
        if (!product) return null;
        return { product, qty };
      })
      .filter(Boolean) as { product: Product; qty: number }[];
  }, [cart, products]);

  const cartTotal = useMemo(() => {
    return cartLines.reduce((sum, line) => sum + line.product.price_cents * line.qty, 0);
  }, [cartLines]);

  const totalStock = useMemo(() => {
    return products.reduce((sum, product) => sum + product.stock, 0);
  }, [products]);

  function adminHeaders(token = adminToken) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  function updateCustomerField(field: keyof CustomerInfo, value: string) {
    setCustomerInfo((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function logoutAdmin() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken("");
    setOrders([]);
    setOrderDetail(null);
    setNotice("Owner signed out.");
  }

  async function loadOrders(token = adminToken) {
    if (!token) {
      setOrders([]);
      return;
    }

    const res = await fetch(`${API_BASE}/api/orders`, {
      headers: adminHeaders(token),
    });

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminToken("");
      setOrders([]);
      setOrderDetail(null);
      throw new Error("Owner session expired. Log in again.");
    }

    if (!res.ok) throw new Error(`Orders failed: ${res.status}`);

    const data: OrdersResponse = await res.json();
    setOrders(data.orders);
  }

  async function loadOrderDetail(orderId: string) {
    if (!adminToken) {
      setError("Owner login required.");
      return;
    }

    setOrderDetailBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderId)}`, {
        headers: adminHeaders(),
      });

      const data: OrderDetailResponse = await res.json();

      if (res.status === 401 || res.status === 403) {
        logoutAdmin();
        throw new Error("Owner session expired. Log in again.");
      }

      if (!res.ok || !data.ok || !data.order) {
        throw new Error(data.error || `Order detail failed: ${res.status}`);
      }

      setOrderDetail({
        order: data.order,
        items: data.items || [],
        uploads: data.uploads || [],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Order detail failed");
    } finally {
      setOrderDetailBusy(false);
    }
  }

  async function boot(token = adminToken) {
    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      if (!healthRes.ok) throw new Error(`Health failed: ${healthRes.status}`);
      const healthData: HealthResponse = await healthRes.json();

      const productsRes = await fetch(`${API_BASE}/api/products`);
      if (!productsRes.ok) throw new Error(`Products failed: ${productsRes.status}`);
      const productsData: ProductsResponse = await productsRes.json();

      setHealth(healthData);
      setProducts(productsData.products);
      setCart((current) => clampCartToProducts(current, productsData.products));
      setCapacity(productsData.capacity || 100);
      setError("");

      if (token) {
        await loadOrders(token);
      } else {
        setOrders([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Backend connection failed");
    }
  }

  useEffect(() => {
    boot();
  }, []);

  async function loginAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setLoginError("");
    setNotice("");
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: adminPassword }),
      });

      const data: AdminLoginResponse = await res.json();

      if (!res.ok || !data.ok || !data.token) {
        throw new Error(data.error || "Owner login failed");
      }

      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminPassword("");
      setNotice("Owner login successful.");
      await boot(data.token);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Owner login failed");
    } finally {
      setBusy(false);
    }
  }

  function scrollToCatalog() {
    const catalog = document.getElementById("catalog");

    if (catalog) {
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.scrollTo({
      top: Math.floor(window.innerHeight * 0.95),
      behavior: "smooth",
    });
  }

  async function refreshSystem() {
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const healthRes = await fetch(`${API_BASE}/api/health`);
      if (!healthRes.ok) throw new Error(`Health failed: ${healthRes.status}`);
      const healthData: HealthResponse = await healthRes.json();

      const productsRes = await fetch(`${API_BASE}/api/products`);
      if (!productsRes.ok) throw new Error(`Products failed: ${productsRes.status}`);
      const productsData: ProductsResponse = await productsRes.json();

      setHealth(healthData);
      setProducts(productsData.products);
      setCart((current) => clampCartToProducts(current, productsData.products));
      setCapacity(productsData.capacity || 100);

      if (adminToken) {
        await loadOrders(adminToken);

        if (orderDetail?.order.id) {
          await loadOrderDetail(orderDetail.order.id);
        }
      }

      setNotice("System refreshed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "System refresh failed");
    } finally {
      setBusy(false);
    }
  }

  function addToCart(product: Product) {
    setCompletedOrder(null);
    setNotice("");
    setError("");

    setCart((current) => {
      const currentQty = current[product.id] || 0;

      if (currentQty >= product.stock) {
        setError(`Only ${product.stock} available for ${product.name}`);
        return current;
      }

      return {
        ...current,
        [product.id]: currentQty + 1,
      };
    });
  }

  function removeOne(productId: string) {
    setCart((current) => {
      const nextQty = (current[productId] || 0) - 1;
      const next = { ...current };

      if (nextQty <= 0) {
        delete next[productId];
      } else {
        next[productId] = nextQty;
      }

      return next;
    });
  }

  function clearCart() {
    setCart({});
    setNotice("");
    setError("");
  }

  function validateCustomerForm() {
    if (!customerInfo.name.trim()) {
      return "Customer name is required.";
    }

    if (!customerInfo.email.trim()) {
      return "Customer email is required.";
    }

    if (!customerInfo.email.includes("@") || !customerInfo.email.includes(".")) {
      return "Enter a valid customer email.";
    }

    return "";
  }

  async function checkout() {
    if (cartLines.length === 0) {
      setError("Cart is empty.");
      return;
    }

    const customerError = validateCustomerForm();

    if (customerError) {
      setError(customerError);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    setBuyerUploadStatus("");

    const items: CartLine[] = cartLines.map((line) => ({
      product_id: line.product.id,
      qty: line.qty,
    }));

    try {
      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: customerInfo,
          items,
        }),
      });

      const data: CheckoutResponse = await res.json();

      if (data.products) {
        setProducts(data.products);
        setCart((current) => clampCartToProducts(current, data.products || []));
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Checkout failed: ${res.status}`);
      }

      setCart({});

      if (data.order?.id) {
        setCompletedOrder({
          id: data.order.id,
          total_cents: data.order.total_cents,
          upload_token: data.order.upload_token || "",
          customer: data.order.customer,
        });
        setBuyerUploadFile(null);
      }

      setNotice(`Order complete: ${data.order?.id || "created"}`);

      if (adminToken) {
        await loadOrders(adminToken);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBuyerFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!completedOrder) {
      setBuyerUploadStatus("Complete checkout first.");
      return;
    }

    if (!completedOrder.upload_token) {
      setBuyerUploadStatus("Upload token missing for this order.");
      return;
    }

    if (!buyerUploadFile) {
      setBuyerUploadStatus("Choose a file first.");
      return;
    }

    setBuyerUploadBusy(true);
    setBuyerUploadStatus("");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", buyerUploadFile);

      const url =
        `${API_BASE}/api/orders/${encodeURIComponent(completedOrder.id)}` +
        `/uploads?token=${encodeURIComponent(completedOrder.upload_token)}`;

      const res = await fetch(url, {
        method: "POST",
        body: formData,
      });

      const data: BuyerUploadResponse = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Upload failed: ${res.status}`);
      }

      setBuyerUploadStatus(`Uploaded: ${data.upload?.original_filename || buyerUploadFile.name}`);
      setBuyerUploadFile(null);

      if (adminToken) {
        await loadOrders(adminToken);

        if (orderDetail?.order.id === completedOrder.id) {
          await loadOrderDetail(completedOrder.id);
        }
      }
    } catch (err: unknown) {
      setBuyerUploadStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBuyerUploadBusy(false);
    }
  }

  async function updateStock(productId: string, stock: number) {
    if (!adminToken) {
      setError("Owner login required.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({ stock }),
      });

      const data = await res.json();

      if (res.status === 401 || res.status === 403) {
        logoutAdmin();
        throw new Error("Owner session expired. Log in again.");
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Stock update failed: ${res.status}`);
      }

      setProducts(data.products);
      setCart((current) => clampCartToProducts(current, data.products || []));
      setNotice("Stock updated.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Stock update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="luxury-shell">
      <div className="lux-bg">
        <div className="gold-grid" />
        <div className="diamond diamond-one" />
        <div className="diamond diamond-two" />
        <div className="diamond diamond-three" />
        <div className="light-beam beam-one" />
        <div className="light-beam beam-two" />
      </div>

      <section className="hero-lux">
        <div className="hero-glass" />

        <div className="top-line">
          <div className="brand-mark">
            <span>WOLF OS™ V3</span>
            <b>I AM THE ONE™</b>
          </div>

          {hasAdminAccess ? (
            <div className="connection-pill">
              <span className={health?.ok ? "dot good" : "dot bad"} />
              {health?.ok ? "Owner Online" : "Backend Offline"}
            </div>
          ) : wantsAdminView ? (
            <div className="connection-pill">Owner Login Required</div>
          ) : (
            <div className="connection-pill customer-pill">Secure Luxury Checkout</div>
          )}
        </div>

        <div className="hero-content">
          <div className="hero-copy-wrap">
            <p className="eyebrow">
              {hasAdminAccess ? "Owner Control Center" : "Premium Luxury Storefront"}
            </p>
            <h1>
              {hasAdminAccess
                ? "Owner dashboard. Protected stock controls. Live order view."
                : "Luxury goods. Premium drops. Clean checkout."}
            </h1>
            <p className="hero-copy">
              {hasAdminAccess
                ? "Manage live inventory, review recent orders, and control the storefront from a protected owner view."
                : "Browse premium products, build your cart, and complete your order through a clean luxury storefront experience."}
            </p>

            <div className="hero-actions">
              <button onClick={scrollToCatalog}>Enter Storefront</button>
              {hasAdminAccess && (
                <>
                  <button className="ghost" onClick={refreshSystem} disabled={busy}>
                    {busy ? "Refreshing..." : "Refresh System"}
                  </button>
                  <button className="ghost" onClick={logoutAdmin}>
                    Sign Out
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="luxury-stage">
            <div className="stage-ring ring-one" />
            <div className="stage-ring ring-two" />
            <div className="crown-card">
              <div className="crown-icon">♛</div>
              <span>Signature Drop</span>
              <h2>{spotlight?.name || "Loading..."}</h2>
              <p>{spotlight?.description || "Preparing premium inventory."}</p>
              <div className="stage-price">
                <strong>{spotlight ? money(spotlight.price_cents) : "$0.00"}</strong>
                <b>{hasAdminAccess ? `${spotlight?.stock ?? 0} left` : customerStockLabel(spotlight?.stock ?? 0)}</b>
              </div>
            </div>
            <div className="floating-chip chip-one">{hasAdminAccess ? "Owner Tools" : "Premium Drop"}</div>
            <div className="floating-chip chip-two">Luxury UI</div>
            <div className="floating-chip chip-three">Checkout</div>
          </div>
        </div>

        <div className="stat-strip">
          <div>
            <span>Catalog Capacity</span>
            <b>{capacity}</b>
          </div>
          <div>
            <span>Active Products</span>
            <b>{products.length}</b>
          </div>
          <div>
            <span>{hasAdminAccess ? "Total Stock" : "Collection"}</span>
            <b>{hasAdminAccess ? totalStock : "Live"}</b>
          </div>
          <div>
            <span>{hasAdminAccess ? "Recent Orders" : "Checkout"}</span>
            <b>{hasAdminAccess ? orders.length : "Ready"}</b>
          </div>
        </div>
      </section>

      {(error || notice) && (
        <section className="message-wrap">
          {error && <div className="message error-box">{error}</div>}
          {notice && <div className="message success-box">{notice}</div>}
        </section>
      )}

      {completedOrder && (
        <section className="admin-login-panel buyer-upload-panel">
          <div>
            <p className="eyebrow small">Order Complete</p>
            <h2>Upload Your File</h2>
            <p>
              Order <strong>{completedOrder.id}</strong> is ready for{" "}
              <strong>{completedOrder.customer?.name || "your customer profile"}</strong>.
            </p>
            <p>
              Order total: <strong>{money(completedOrder.total_cents)}</strong>
            </p>
          </div>

          <form onSubmit={uploadBuyerFile}>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.doc,.docx,.zip"
              onChange={(event) => setBuyerUploadFile(event.target.files?.[0] || null)}
            />
            <button disabled={buyerUploadBusy || !buyerUploadFile}>
              {buyerUploadBusy ? "Uploading..." : "Upload File"}
            </button>
            {buyerUploadStatus && <span>{buyerUploadStatus}</span>}
          </form>
        </section>
      )}

      {wantsAdminView && !hasAdminAccess && (
        <section className="admin-login-panel">
          <div>
            <p className="eyebrow small">Protected Owner Access</p>
            <h2>Owner/Admin Login</h2>
            <p>Enter your owner password to unlock stock controls, recent orders, and protected admin tools.</p>
          </div>

          <form onSubmit={loginAdmin}>
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              placeholder="Owner password"
              autoComplete="current-password"
            />
            <button disabled={busy || !adminPassword.trim()}>
              {busy ? "Checking..." : "Unlock Owner View"}
            </button>
            {loginError && <span>{loginError}</span>}
          </form>
        </section>
      )}

      <section id="catalog" className="command-bar">
        <div>
          <p className="eyebrow small">{hasAdminAccess ? "Owner Catalog" : "Shop The Collection"}</p>
          <h2>{hasAdminAccess ? "Premium Inventory" : "Featured Products"}</h2>
          <span>
            Showing {visibleProducts.length} of {products.length}
          </span>
        </div>

        <div className="controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, SKU, category..."
          />

          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="featured">Featured</option>
            <option value="name">Name</option>
            <option value="price-low">Price Low</option>
            <option value="price-high">Price High</option>
            <option value="stock-high">Stock High</option>
          </select>
        </div>
      </section>

      <section className="store-layout">
        <section className="product-grid">
          {visibleProducts.map((product, index) => {
            const inCart = cart[product.id] || 0;
            const canAdd = product.stock > inCart;
            const lowStock = product.stock > 0 && product.stock <= 5;

            return (
              <article className="product-card" key={product.id}>
                <div className="card-shimmer" />
                <div className="card-number">{String(index + 1).padStart(2, "0")}</div>

                <div className="image-wrap">
                  <ProductImage sku={product.sku} name={product.name} remoteUrl={product.image_url} />
                  <span>{product.category}</span>
                  {lowStock && <b className="low-stock">{hasAdminAccess ? "Low stock" : "Limited"}</b>}
                </div>

                <div className="product-body">
                  <div className="sku-row">
                    <span>{product.sku}</span>
                    <b>{money(product.price_cents)}</b>
                  </div>

                  <h3>{product.name}</h3>
                  <p>{product.description}</p>

                  <div className="product-meta">
                    {hasAdminAccess ? (
                      <>
                        <span>{product.stock} in stock</span>
                        <span>{inCart} in cart</span>
                      </>
                    ) : (
                      <>
                        <span>{customerStockLabel(product.stock)}</span>
                        {inCart > 0 ? <span>{inCart} in cart</span> : <span>Ready to ship</span>}
                      </>
                    )}
                  </div>

                  <button
                    className="primary-btn"
                    disabled={!canAdd || busy}
                    onClick={() => addToCart(product)}
                  >
                    {canAdd ? "Add to Cart" : "Sold Out"}
                  </button>

                  {hasAdminAccess && (
                    <div className="operator-stock">
                      <button
                        disabled={busy}
                        onClick={() => updateStock(product.id, Math.max(0, product.stock - 1))}
                      >
                        - Stock
                      </button>
                      <button disabled={busy} onClick={() => updateStock(product.id, product.stock + 1)}>
                        + Stock
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <aside className="cart-panel">
          <div className="cart-head">
            <div>
              <p className="eyebrow small">Checkout</p>
              <h2>Cart</h2>
            </div>
            <button className="ghost-btn" onClick={clearCart} disabled={cartLines.length === 0}>
              Clear
            </button>
          </div>

          {cartLines.length === 0 ? (
            <p className="empty">No items in cart yet.</p>
          ) : (
            <div className="cart-lines">
              {cartLines.map(({ product, qty }) => (
                <div className="cart-line" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>
                      {qty} × {money(product.price_cents)}
                    </span>
                  </div>

                  <div className="cart-actions">
                    <button onClick={() => removeOne(product.id)}>-</button>
                    <b>{qty}</b>
                    <button onClick={() => addToCart(product)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="checkout-customer-form" onSubmit={(event) => event.preventDefault()}>
            <p className="eyebrow small">Customer Info</p>

            <input
              value={customerInfo.name}
              onChange={(event) => updateCustomerField("name", event.target.value)}
              placeholder="Full name *"
              autoComplete="name"
            />

            <input
              type="email"
              value={customerInfo.email}
              onChange={(event) => updateCustomerField("email", event.target.value)}
              placeholder="Email *"
              autoComplete="email"
            />

            <input
              value={customerInfo.phone}
              onChange={(event) => updateCustomerField("phone", event.target.value)}
              placeholder="Phone"
              autoComplete="tel"
            />

            <input
              value={customerInfo.address}
              onChange={(event) => updateCustomerField("address", event.target.value)}
              placeholder="Street address"
              autoComplete="street-address"
            />

            <div className="checkout-customer-row">
              <input
                value={customerInfo.city}
                onChange={(event) => updateCustomerField("city", event.target.value)}
                placeholder="City"
                autoComplete="address-level2"
              />
              <input
                value={customerInfo.state}
                onChange={(event) => updateCustomerField("state", event.target.value)}
                placeholder="State"
                autoComplete="address-level1"
              />
              <input
                value={customerInfo.zip}
                onChange={(event) => updateCustomerField("zip", event.target.value)}
                placeholder="ZIP"
                autoComplete="postal-code"
              />
            </div>

            <textarea
              value={customerInfo.notes}
              onChange={(event) => updateCustomerField("notes", event.target.value)}
              placeholder="Order notes"
              rows={3}
            />
          </form>

          <div className="cart-total">
            <span>Total</span>
            <strong>{money(cartTotal)}</strong>
          </div>

          <button className="checkout-btn" disabled={busy || cartLines.length === 0} onClick={checkout}>
            {busy ? "Processing..." : "Checkout"}
          </button>

          {hasAdminAccess && (
            <div className="orders-panel">
              <div className="orders-head">
                <p className="eyebrow small">Owner</p>
                <h3>Recent Orders</h3>
              </div>

              {orders.length === 0 ? (
                <p className="empty">No orders yet.</p>
              ) : (
                <div className="orders-list">
                  {orders.slice(0, 8).map((order) => (
                    <div className="order-row" key={order.id}>
                      <div>
                        <strong>{order.id}</strong>
                        <span>
                          {order.customer_name ? `${order.customer_name} · ` : ""}
                          {order.status} · {shortDate(order.created_at)}
                        </span>
                        {order.customer_email && <span>{order.customer_email}</span>}
                      </div>

                      <div className="order-actions">
                        <b>{money(order.total_cents)}</b>
                        <button
                          type="button"
                          disabled={orderDetailBusy}
                          onClick={() => loadOrderDetail(order.id)}
                        >
                          View
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {orderDetail && (
                <div className="order-detail-panel">
                  <div className="order-detail-head">
                    <div>
                      <p className="eyebrow small">Order Detail</p>
                      <h3>{orderDetail.order.id}</h3>
                    </div>

                    <button type="button" onClick={() => setOrderDetail(null)}>
                      Close
                    </button>
                  </div>

                  <div className="detail-grid">
                    <div>
                      <span>Customer</span>
                      <strong>{orderDetail.order.customer_name || "Unknown"}</strong>
                      <p>{orderDetail.order.customer_email || "No email"}</p>
                      <p>{orderDetail.order.customer_phone || "No phone"}</p>
                    </div>

                    <div>
                      <span>Shipping</span>
                      <strong>{orderDetail.order.shipping_address || "No address"}</strong>
                      <p>
                        {[orderDetail.order.shipping_city, orderDetail.order.shipping_state, orderDetail.order.shipping_zip]
                          .filter(Boolean)
                          .join(", ") || "No city/state/zip"}
                      </p>
                    </div>

                    <div>
                      <span>Status</span>
                      <strong>{orderDetail.order.status}</strong>
                      <p>{shortDate(orderDetail.order.created_at)}</p>
                    </div>

                    <div>
                      <span>Total</span>
                      <strong>{money(orderDetail.order.total_cents)}</strong>
                      <p>{orderDetail.items.length} item line(s)</p>
                    </div>
                  </div>

                  {orderDetail.order.order_notes && (
                    <div className="detail-note">
                      <span>Notes</span>
                      <p>{orderDetail.order.order_notes}</p>
                    </div>
                  )}

                  <div className="detail-section">
                    <p className="eyebrow small">Purchased Items</p>
                    {orderDetail.items.length === 0 ? (
                      <p className="empty">No item records found.</p>
                    ) : (
                      <div className="detail-list">
                        {orderDetail.items.map((item) => (
                          <div className="detail-line" key={item.id}>
                            <div>
                              <strong>{item.name}</strong>
                              <span>
                                {item.sku} · Qty {item.quantity} × {money(item.unit_price_cents)}
                              </span>
                            </div>
                            <b>{money(item.line_total_cents)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="detail-section">
                    <p className="eyebrow small">Buyer Uploads</p>
                    {orderDetail.uploads.length === 0 ? (
                      <p className="empty">No buyer uploads attached yet.</p>
                    ) : (
                      <div className="detail-list">
                        {orderDetail.uploads.map((upload) => (
                          <div className="detail-line" key={upload.id}>
                            <div>
                              <strong>{upload.original_filename}</strong>
                              <span>
                                {upload.content_type || "file"} · {fileSizeLabel(upload.size_bytes)} · {shortDate(upload.created_at)}
                              </span>
                            </div>
                            <b>{upload.id}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="detail-token">
                    <span>Buyer upload token</span>
                    <code>{orderDetail.order.upload_token}</code>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="legal-footer">
        <div>
          <strong>I AM THE ONE™</strong>
          <span>Powered by WOLF OS™ V3</span>
        </div>

        <p>
          © 2026 Andrew Wolverton. All Rights Reserved.
          I AM THE ONE™, WOLF OS™, and related product names, marks, designs,
          software, storefront layouts, visual assets, and system concepts are
          claimed as proprietary intellectual property of Andrew Wolverton.
        </p>
      </footer>
    </main>
  );
}
