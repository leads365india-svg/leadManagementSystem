"use client"

import React, { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "react-hot-toast"
import { apiClient } from "@/lib/api"
import AIKeywordsTab from "./ai-keywords-tab"
import {
  Sparkles,
  Building2,
  Package,
  BookOpen,
  Plus,
  UploadCloud,
  Globe,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
  Edit3,
  ExternalLink,
  ChevronRight,
  Info,
  X,
  File,
  Layers,
  ArrowRight,
  Tag,
  DollarSign,
  ShieldCheck,
  Eye,
  RotateCw,
  Copy,
  Check,
} from "lucide-react"

const INDUSTRY_PRESETS = [
  "Furniture",
  "Healthcare",
  "Real Estate",
  "Education",
  "Automobile",
  "Insurance",
  "Finance",
  "Retail",
  "Travel",
  "Other",
]

const LANGUAGE_OPTIONS = [
  "English",
  "Hindi",
  "Hinglish",
  "Marathi",
  "Gujarati",
  "Bengali",
  "Tamil",
  "Telugu",
  "Kannada",
  "Punjabi",
  "Malayalam",
  "Spanish",
  "Arabic",
  "French",
  "German",
]

export default function AIKnowledgeClient() {
  const [activeTab, setActiveTab] = useState("profile") // "profile" | "products" | "sources"

  // ==========================================
  // TAB 1: BUSINESS PROFILE STATE
  // ==========================================
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileForm, setProfileForm] = useState({
    businessName: "",
    industry: "Other",
    customIndustry: "",
    description: "",
    website: "",
    contactEmail: "",
    contactPhone: "",
    address: {
      street: "",
      city: "",
      state: "",
      country: "India",
      postalCode: "",
    },
    languages: ["English", "Hindi"],
    status: "active",
  })
  const [newLanguageInput, setNewLanguageInput] = useState("")

  // ==========================================
  // TAB 2: PRODUCTS & SERVICES STATE
  // ==========================================
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productSearch, setProductSearch] = useState("")
  const [productTypeFilter, setProductTypeFilter] = useState("all") // "all" | "PRODUCT" | "SERVICE"
  const [productStatusFilter, setProductStatusFilter] = useState("active") // "active" | "all" | "archived"
  const [showProductModal, setShowProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [productSaving, setProductSaving] = useState(false)
  const [productForm, setProductForm] = useState({
    name: "",
    type: "PRODUCT",
    category: "",
    description: "",
    price: { amount: 0, currency: "INR", billingCycle: "one-time" },
    featuresText: "",
    notes: "",
    status: "active",
  })

  // ==========================================
  // TAB 3: AI KNOWLEDGE SOURCES STATE
  // ==========================================
  const [sources, setSources] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesSummary, setSourcesSummary] = useState({
    total: 0,
    completed: 0,
    processing: 0,
    failed: 0,
    totalWords: 0,
  })
  const [sourceSearch, setSourceSearch] = useState("")
  const [sourceTypeFilter, setSourceTypeFilter] = useState("all")
  const [sourceStatusFilter, setSourceStatusFilter] = useState("all")
  const [sourceProductFilter, setSourceProductFilter] = useState("all")

  // Modals for Knowledge Sources
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showWebsiteModal, setShowWebsiteModal] = useState(false)
  const [showManualModal, setShowManualModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [selectedSourceForPreview, setSelectedSourceForPreview] = useState(null)

  // Upload Form
  const [uploadFileObj, setUploadFileObj] = useState(null)
  const [uploadTitle, setUploadTitle] = useState("")
  const [uploadProductId, setUploadProductId] = useState("none")
  const [uploading, setUploading] = useState(false)

  // Website Form
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [websiteTitle, setWebsiteTitle] = useState("")
  const [websiteProductId, setWebsiteProductId] = useState("none")
  const [fetchingWebsite, setFetchingWebsite] = useState(false)

  // Manual Form
  const [manualTitle, setManualTitle] = useState("")
  const [manualContent, setManualContent] = useState("")
  const [manualCategory, setManualCategory] = useState("General Business Information")
  const [manualProductId, setManualProductId] = useState("none")
  const [savingManual, setSavingManual] = useState(false)

  // Action states
  const [retryingId, setRetryingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [copiedText, setCopiedText] = useState(false)

  // ==========================================
  // DATA FETCHING
  // ==========================================

  // Load Business Profile
  const loadProfile = useCallback(async () => {
    try {
      setProfileLoading(true)
      const res = await apiClient.getBusinessProfile()
      if (res && res.success && res.data) {
        setProfileForm({
          businessName: res.data.businessName || "",
          industry: res.data.industry || "Other",
          customIndustry: res.data.customIndustry || "",
          description: res.data.description || "",
          website: res.data.website || "",
          contactEmail: res.data.contactEmail || "",
          contactPhone: res.data.contactPhone || "",
          address: {
            street: res.data.address?.street || "",
            city: res.data.address?.city || "",
            state: res.data.address?.state || "",
            country: res.data.address?.country || "India",
            postalCode: res.data.address?.postalCode || "",
          },
          languages: res.data.languages || ["English", "Hindi"],
          status: res.data.status || "active",
        })
      }
    } catch (err) {
      toast.error(err.message || "Failed to load business profile")
    } finally {
      setProfileLoading(false)
    }
  }, [])

  // Load Products & Services
  const loadProducts = useCallback(async () => {
    try {
      setProductsLoading(true)
      const query = {
        search: productSearch,
        type: productTypeFilter,
        status: productStatusFilter,
        limit: 100,
      }
      const res = await apiClient.getBusinessProducts(query)
      if (res && res.success && res.data) {
        setProducts(res.data.products || [])
      }
    } catch (err) {
      toast.error(err.message || "Failed to load products")
    } finally {
      setProductsLoading(false)
    }
  }, [productSearch, productTypeFilter, productStatusFilter])

  // Load Knowledge Sources
  const loadSources = useCallback(async () => {
    try {
      setSourcesLoading(true)
      const query = {
        search: sourceSearch,
        sourceType: sourceTypeFilter,
        status: sourceStatusFilter,
        productId: sourceProductFilter === "all" ? "" : sourceProductFilter,
        limit: 100,
      }
      const res = await apiClient.getKnowledgeSources(query)
      if (res && res.success && res.data) {
        setSources(res.data.sources || [])
        if (res.data.summary) {
          setSourcesSummary(res.data.summary)
        }
      }
    } catch (err) {
      toast.error(err.message || "Failed to load knowledge sources")
    } finally {
      setSourcesLoading(false)
    }
  }, [sourceSearch, sourceTypeFilter, sourceStatusFilter, sourceProductFilter])

  // Initial load
  useEffect(() => {
    loadProfile()
    loadProducts()
    loadSources()
  }, [loadProfile, loadProducts, loadSources])

  // Reload products/sources when tab switches
  useEffect(() => {
    if (activeTab === "products") loadProducts()
    if (activeTab === "sources") {
      loadSources()
      loadProducts() // to populate product dropdowns
    }
  }, [activeTab, loadProducts, loadSources])

  // ==========================================
  // TAB 1 HANDLERS: BUSINESS PROFILE
  // ==========================================

  const handleProfileSave = async (e) => {
    e.preventDefault()
    if (!profileForm.businessName || profileForm.businessName.trim().length < 2) {
      toast.error("Business name is required (minimum 2 characters)")
      return
    }

    try {
      setProfileSaving(true)
      const res = await apiClient.updateBusinessProfile(profileForm)
      if (res && res.success) {
        toast.success("Business profile saved successfully!")
        loadProfile()
      } else {
        toast.error(res?.error || "Failed to save profile")
      }
    } catch (err) {
      toast.error(err.message || "Error saving business profile")
    } finally {
      setProfileSaving(false)
    }
  }

  const handleToggleLanguage = (lang) => {
    setProfileForm((prev) => {
      const exists = prev.languages.includes(lang)
      return {
        ...prev,
        languages: exists ? prev.languages.filter((l) => l !== lang) : [...prev.languages, lang],
      }
    })
  }

  const handleAddCustomLanguage = (e) => {
    e.preventDefault()
    const clean = newLanguageInput.trim()
    if (!clean) return
    if (!profileForm.languages.includes(clean)) {
      setProfileForm((prev) => ({
        ...prev,
        languages: [...prev.languages, clean],
      }))
    }
    setNewLanguageInput("")
  }

  // ==========================================
  // TAB 2 HANDLERS: PRODUCTS & SERVICES
  // ==========================================

  const handleOpenCreateProduct = () => {
    setEditingProduct(null)
    setProductForm({
      name: "",
      type: "PRODUCT",
      category: "",
      description: "",
      price: { amount: 0, currency: "INR", billingCycle: "one-time" },
      featuresText: "",
      notes: "",
      status: "active",
    })
    setShowProductModal(true)
  }

  const handleOpenEditProduct = (product) => {
    setEditingProduct(product)
    setProductForm({
      name: product.name || "",
      type: product.type || "PRODUCT",
      category: product.category || "",
      description: product.description || "",
      price: {
        amount: product.price?.amount || 0,
        currency: product.price?.currency || "INR",
        billingCycle: product.price?.billingCycle || "one-time",
      },
      featuresText: Array.isArray(product.features) ? product.features.join("\n") : "",
      notes: product.notes || "",
      status: product.status || "active",
    })
    setShowProductModal(true)
  }

  const handleSaveProduct = async (e) => {
    e.preventDefault()
    if (!productForm.name || productForm.name.trim().length < 2) {
      toast.error("Valid product/service name is required (min 2 characters)")
      return
    }

    try {
      setProductSaving(true)
      const featuresArray = productForm.featuresText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)

      const payload = {
        name: productForm.name.trim(),
        type: productForm.type,
        category: productForm.category.trim(),
        description: productForm.description.trim(),
        price: {
          amount: Number(productForm.price.amount) || 0,
          currency: productForm.price.currency,
          billingCycle: productForm.price.billingCycle,
        },
        features: featuresArray,
        notes: productForm.notes.trim(),
        status: productForm.status,
      }

      let res = null
      if (editingProduct) {
        res = await apiClient.updateBusinessProduct(editingProduct._id || editingProduct.id, payload)
      } else {
        res = await apiClient.createBusinessProduct(payload)
      }

      if (res && res.success) {
        toast.success(editingProduct ? "Product updated successfully!" : "Product created successfully!")
        setShowProductModal(false)
        loadProducts()
      } else {
        toast.error(res?.error || "Failed to save product")
      }
    } catch (err) {
      toast.error(err.message || "Error saving product")
    } finally {
      setProductSaving(false)
    }
  }

  const handleToggleProductStatus = async (product) => {
    try {
      const res = await apiClient.toggleBusinessProductStatus(product._id || product.id)
      if (res && res.success) {
        toast.success(`Marked as ${res.data.status}`)
        loadProducts()
      } else {
        toast.error(res?.error || "Failed to update status")
      }
    } catch (err) {
      toast.error(err.message || "Failed to update product status")
    }
  }

  const handleDeleteProduct = async (product) => {
    const hasRefs = (product.knowledgeSourcesCount || 0) > 0
    const msg = hasRefs
      ? `"${product.name}" is referenced by ${product.knowledgeSourcesCount} knowledge source(s). It will be safely archived to protect historical data. Proceed?`
      : `Are you sure you want to delete or archive "${product.name}"?`

    if (!confirm(msg)) return

    try {
      const res = await apiClient.deleteBusinessProduct(product._id || product.id)
      if (res && res.success) {
        toast.success(res.message || "Product archived successfully")
        loadProducts()
      } else {
        toast.error(res?.error || "Failed to remove product")
      }
    } catch (err) {
      toast.error(err.message || "Error removing product")
    }
  }

  // ==========================================
  // TAB 3 HANDLERS: KNOWLEDGE SOURCES
  // ==========================================

  // Document Upload
  const handleUploadSubmit = async (e) => {
    e.preventDefault()
    if (!uploadFileObj) {
      toast.error("Please choose a file to upload (.pdf, .docx, .xlsx, .csv, .txt)")
      return
    }

    try {
      setUploading(true)
      const formData = new FormData()
      formData.append("document", uploadFileObj)
      if (uploadTitle.trim()) formData.append("title", uploadTitle.trim())
      if (uploadProductId && uploadProductId !== "none") formData.append("productId", uploadProductId)

      const res = await apiClient.uploadKnowledgeDocument(formData)
      if (res && res.success) {
        toast.success(res.message || "Document uploaded and processed!")
        setShowUploadModal(false)
        setUploadFileObj(null)
        setUploadTitle("")
        setUploadProductId("none")
        loadSources()
      } else {
        toast.error(res?.error || "Document upload failed")
      }
    } catch (err) {
      toast.error(err.message || "Error processing document upload")
    } finally {
      setUploading(false)
    }
  }

  // Website Extract
  const handleWebsiteSubmit = async (e) => {
    e.preventDefault()
    if (!websiteUrl || !websiteUrl.trim()) {
      toast.error("Please enter a valid website URL")
      return
    }

    try {
      setFetchingWebsite(true)
      const payload = {
        url: websiteUrl.trim(),
        title: websiteTitle.trim() || undefined,
        productId: websiteProductId !== "none" ? websiteProductId : undefined,
      }

      const res = await apiClient.addKnowledgeWebsite(payload)
      if (res && res.success) {
        toast.success(res.message || "Website content extracted successfully!")
        setShowWebsiteModal(false)
        setWebsiteUrl("")
        setWebsiteTitle("")
        setWebsiteProductId("none")
        loadSources()
      } else {
        toast.error(res?.error || "Website extraction failed")
      }
    } catch (err) {
      toast.error(err.message || "Error extracting website URL")
    } finally {
      setFetchingWebsite(false)
    }
  }

  // Manual Add
  const handleManualSubmit = async (e) => {
    e.preventDefault()
    if (!manualTitle || !manualTitle.trim()) {
      toast.error("Please provide a title for this knowledge note")
      return
    }
    if (!manualContent || manualContent.trim().length < 10) {
      toast.error("Knowledge content must be at least 10 characters")
      return
    }

    try {
      setSavingManual(true)
      const payload = {
        title: manualTitle.trim(),
        content: manualContent.trim(),
        category: manualCategory.trim(),
        productId: manualProductId !== "none" ? manualProductId : undefined,
      }

      const res = await apiClient.addKnowledgeManual(payload)
      if (res && res.success) {
        toast.success(res.message || "Manual knowledge saved successfully!")
        setShowManualModal(false)
        setManualTitle("")
        setManualContent("")
        setManualCategory("General Business Information")
        setManualProductId("none")
        loadSources()
      } else {
        toast.error(res?.error || "Failed to save manual knowledge")
      }
    } catch (err) {
      toast.error(err.message || "Error saving manual note")
    } finally {
      setSavingManual(false)
    }
  }

  // Retry extraction
  const handleRetrySource = async (source) => {
    try {
      setRetryingId(source._id || source.id)
      const res = await apiClient.retryKnowledgeSource(source._id || source.id)
      if (res && res.success) {
        toast.success(res.message || "Retry completed!")
        loadSources()
      } else {
        toast.error(res?.error || "Retry failed")
      }
    } catch (err) {
      toast.error(err.message || "Error during retry")
    } finally {
      setRetryingId(null)
    }
  }

  // Delete source
  const handleDeleteSource = async (source) => {
    if (!confirm(`Are you sure you want to remove "${source.title}"?`)) return
    try {
      setDeletingId(source._id || source.id)
      const res = await apiClient.deleteKnowledgeSource(source._id || source.id)
      if (res && res.success) {
        toast.success(res.message || "Source removed successfully")
        loadSources()
      } else {
        toast.error(res?.error || "Failed to remove source")
      }
    } catch (err) {
      toast.error(err.message || "Error removing knowledge source")
    } finally {
      setDeletingId(null)
    }
  }

  // View text preview
  const handleOpenPreview = async (source) => {
    try {
      // Fetch full source details with extractedText
      const res = await apiClient.getKnowledgeSourceById(source._id || source.id)
      if (res && res.success && res.data) {
        setSelectedSourceForPreview(res.data)
        setShowPreviewModal(true)
      } else {
        toast.error("Could not load preview")
      }
    } catch (err) {
      toast.error(err.message || "Failed to load preview")
    }
  }

  const handleCopyExtractedText = () => {
    if (selectedSourceForPreview?.extractedText) {
      navigator.clipboard.writeText(selectedSourceForPreview.extractedText)
      setCopiedText(true)
      toast.success("Text copied to clipboard")
      setTimeout(() => setCopiedText(false), 2000)
    }
  }

  // Helper: Source Type Badges
  const renderSourceTypeBadge = (type) => {
    const t = (type || "").toLowerCase()
    switch (t) {
      case "pdf":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <FileText className="w-3 h-3" />
            PDF
          </span>
        )
      case "docx":
      case "doc":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <File className="w-3 h-3" />
            DOCX
          </span>
        )
      case "xlsx":
      case "xls":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <FileSpreadsheet className="w-3 h-3" />
            Excel
          </span>
        )
      case "csv":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
            <FileSpreadsheet className="w-3 h-3" />
            CSV
          </span>
        )
      case "website":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Globe className="w-3 h-3" />
            Website
          </span>
        )
      case "manual":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <BookOpen className="w-3 h-3" />
            Manual Note
          </span>
        )
    }
  }

  // Helper: Status Badges
  const renderStatusBadge = (status) => {
    const s = (status || "").toUpperCase()
    switch (s) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Extracted
          </span>
        )
      case "PROCESSING":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
            Processing
          </span>
        )
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-600" />
            Failed
          </span>
        )
      case "PENDING":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <AlertCircle className="w-3 h-3 text-slate-500" />
            Pending
          </span>
        )
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16">
      {/* Top Header & Breadcrumbs */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-6 shadow-2xs">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1.5">
                <Link href="/portal" className="hover:text-slate-800 transition">Home</Link>
                <ChevronRight className="w-3 h-3" />
                <span>Settings</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-indigo-600 font-semibold">AI Business Knowledge</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
                  <Sparkles className="w-5 h-5" />
                </span>
                AI Call Intelligence — Business Knowledge
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Phase 1: Establish tenant-isolated business foundation, product/service catalog, and document knowledge base.
              </p>
            </div>

            {/* Tab Navigation Pill Switcher */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 shadow-2xs text-xs font-medium self-start md:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer ${
                  activeTab === "profile"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Business Profile</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("products")}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer ${
                  activeTab === "products"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Products & Services</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-bold">
                  {products.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("sources")}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer ${
                  activeTab === "sources"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Knowledge Sources</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-100 text-indigo-800 font-bold">
                  {sources.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("keywords")}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer ${
                  activeTab === "keywords"
                    ? "bg-white text-indigo-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>AI Keywords & Topics</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* ==========================================
            TAB 1: BUSINESS PROFILE
        ========================================== */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 md:p-8">
              <div className="flex items-center justify-between pb-6 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Tenant Business Profile</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Define your business identity, core industry, and communication preferences for tenant AI intelligence.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      profileForm.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        profileForm.status === "active" ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                    />
                    {profileForm.status === "active" ? "Active Profile" : "Inactive Profile"}
                  </span>
                </div>
              </div>

              {profileLoading ? (
                <div className="py-16 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
                  <p className="text-xs">Loading business profile...</p>
                </div>
              ) : (
                <form onSubmit={handleProfileSave} className="mt-6 space-y-6">
                  {/* Basic Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Business / Company Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={profileForm.businessName}
                        onChange={(e) => setProfileForm({ ...profileForm, businessName: e.target.value })}
                        placeholder="e.g. Royal Oak Furnishings Pvt Ltd"
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Industry / Category <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={profileForm.industry}
                        onChange={(e) => setProfileForm({ ...profileForm, industry: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        {INDUSTRY_PRESETS.map((ind) => (
                          <option key={ind} value={ind}>
                            {ind}
                          </option>
                        ))}
                      </select>
                    </div>

                    {profileForm.industry === "Other" && (
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Specify Custom Business Category
                        </label>
                        <input
                          type="text"
                          value={profileForm.customIndustry}
                          onChange={(e) => setProfileForm({ ...profileForm, customIndustry: e.target.value })}
                          placeholder="e.g. SaaS / Cloud Accounting Services"
                          className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Company Website URL</label>
                      <input
                        type="url"
                        value={profileForm.website}
                        onChange={(e) => setProfileForm({ ...profileForm, website: e.target.value })}
                        placeholder="https://example.com"
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Contact Email Address</label>
                      <input
                        type="email"
                        value={profileForm.contactEmail}
                        onChange={(e) => setProfileForm({ ...profileForm, contactEmail: e.target.value })}
                        placeholder="contact@business.com"
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Primary Contact Phone</label>
                      <input
                        type="tel"
                        value={profileForm.contactPhone}
                        onChange={(e) => setProfileForm({ ...profileForm, contactPhone: e.target.value })}
                        placeholder="+91 98765 43210"
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">Country / Headquarters</label>
                      <input
                        type="text"
                        value={profileForm.address.country}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            address: { ...profileForm.address, country: e.target.value },
                          })
                        }
                        placeholder="India"
                        className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Business Description */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Business Overview & Value Proposition
                    </label>
                    <textarea
                      rows={4}
                      value={profileForm.description}
                      onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                      placeholder="Describe what your company does, target clientele, key specializations, and warranties..."
                      className="w-full border border-slate-200 rounded-lg p-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      This description provides foundational context for AI call transcript analysis and customer intent recognition.
                    </p>
                  </div>

                  {/* Preferred Customer Communication Languages */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Preferred Customer Communication Languages
                    </label>
                    <p className="text-xs text-slate-500 mb-3">
                      Select all languages your customer support and sales team engage with:
                    </p>

                    <div className="flex flex-wrap gap-2 mb-3">
                      {LANGUAGE_OPTIONS.map((lang) => {
                        const isSelected = profileForm.languages.includes(lang)
                        return (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => handleToggleLanguage(lang)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                              isSelected
                                ? "bg-indigo-600 text-white shadow-2xs font-semibold"
                                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3" />}
                            <span>{lang}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Custom Language Adder */}
                    <div className="flex items-center gap-2 max-w-sm">
                      <input
                        type="text"
                        value={newLanguageInput}
                        onChange={(e) => setNewLanguageInput(e.target.value)}
                        placeholder="Add custom language..."
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomLanguage}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-medium transition cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Status Toggle & Submit */}
                  <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profileForm.status === "active"}
                        onChange={(e) =>
                          setProfileForm({
                            ...profileForm,
                            status: e.target.checked ? "active" : "inactive",
                          })
                        }
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                      />
                      <span className="text-xs font-semibold text-slate-700">
                        Enable this Business Profile for AI Call Intelligence
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {profileSaving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Saving Profile...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Save Business Profile</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ==========================================
            TAB 2: PRODUCTS & SERVICES LIBRARY
        ========================================== */}
        {activeTab === "products" && (
          <div className="space-y-6">
            {/* Header with Search and Create Button */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Product & Service Catalog</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Maintain offerings so incoming calls can be matched to specific products, features, and pricing.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenCreateProduct}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Product / Service</span>
                </button>
              </div>

              {/* Filters & Search Row */}
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search products by name, category, features..."
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={productTypeFilter}
                    onChange={(e) => setProductTypeFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="all">All Types</option>
                    <option value="PRODUCT">Products Only</option>
                    <option value="SERVICE">Services Only</option>
                  </select>

                  <select
                    value={productStatusFilter}
                    onChange={(e) => setProductStatusFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="active">Active Only</option>
                    <option value="all">All (Active & Inactive)</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Products List / Grid */}
            {productsLoading ? (
              <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
                <p className="text-xs">Loading products...</p>
              </div>
            ) : products.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-2xl border border-slate-200 p-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                  <Package className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">No products or services found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-5">
                  Add the items your business offers so knowledge documents and customer call inquiries can be tied to them.
                </p>
                <button
                  type="button"
                  onClick={handleOpenCreateProduct}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add First Product / Service</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {products.map((product) => (
                  <div
                    key={product._id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top Header Row */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                            product.type === "PRODUCT"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-purple-50 text-purple-700 border border-purple-200"
                          }`}
                        >
                          <Tag className="w-3 h-3" />
                          {product.type}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              product.status === "active"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : product.status === "archived"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                product.status === "active"
                                  ? "bg-emerald-500"
                                  : product.status === "archived"
                                  ? "bg-amber-500"
                                  : "bg-slate-400"
                              }`}
                            />
                            {product.status}
                          </span>
                        </div>
                      </div>

                      {/* Product Name & Category */}
                      <h3 className="text-base font-bold text-slate-900 leading-snug">{product.name}</h3>
                      {product.category && (
                        <p className="text-xs text-indigo-600 font-medium mt-0.5">{product.category}</p>
                      )}

                      {/* Price Information */}
                      {product.price && product.price.amount > 0 && (
                        <div className="mt-2.5 flex items-baseline gap-1 text-slate-800 font-bold text-sm">
                          <span>{product.price.currency}</span>
                          <span>{product.price.amount.toLocaleString()}</span>
                          {product.price.billingCycle && (
                            <span className="text-[11px] font-normal text-slate-500">
                              / {product.price.billingCycle}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Description */}
                      {product.description && (
                        <p className="text-xs text-slate-600 line-clamp-2 mt-2 leading-relaxed">
                          {product.description}
                        </p>
                      )}

                      {/* Features Badges */}
                      {product.features && product.features.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {product.features.slice(0, 3).map((f, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium"
                            >
                              • {f}
                            </span>
                          ))}
                          {product.features.length > 3 && (
                            <span className="px-1.5 py-0.5 text-slate-400 text-[10px]">
                              +{product.features.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom Stats & Actions */}
                    <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 text-slate-500 text-[11px]">
                        <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                        <span>{product.knowledgeSourcesCount || 0} Knowledge Docs</span>
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleProductStatus(product)}
                          title={product.status === "active" ? "Deactivate" : "Activate"}
                          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditProduct(product)}
                          title="Edit"
                          className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(product)}
                          title="Archive / Remove"
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==========================================
            TAB 3: AI KNOWLEDGE SOURCES
        ========================================== */}
        {activeTab === "sources" && (
          <div className="space-y-6">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                <span className="text-xs font-semibold text-slate-500">Total Sources</span>
                <p className="text-2xl font-bold text-slate-900 mt-1">{sourcesSummary.total}</p>
              </div>

              <div className="bg-white rounded-2xl border border-emerald-100 p-4 shadow-xs bg-emerald-50/20">
                <span className="text-xs font-semibold text-emerald-700">Successfully Extracted</span>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{sourcesSummary.completed}</p>
              </div>

              <div className="bg-white rounded-2xl border border-amber-100 p-4 shadow-xs bg-amber-50/20">
                <span className="text-xs font-semibold text-amber-700">Processing / Pending</span>
                <p className="text-2xl font-bold text-amber-700 mt-1">
                  {sourcesSummary.processing + sourcesSummary.pending}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-indigo-100 p-4 shadow-xs bg-indigo-50/20">
                <span className="text-xs font-semibold text-indigo-700">Total Knowledge Words</span>
                <p className="text-2xl font-bold text-indigo-700 mt-1">
                  {sourcesSummary.totalWords.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Action Bar & Filters */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Knowledge Sources</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Upload product catalogs (PDF, Word, Excel, CSV), website URLs, and manual business notes.
                  </p>
                </div>

                {/* 3 Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload Document</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowWebsiteModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Add Website URL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowManualModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Add Manual Note</span>
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    placeholder="Search knowledge sources..."
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <select
                  value={sourceTypeFilter}
                  onChange={(e) => setSourceTypeFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Formats</option>
                  <option value="pdf">PDF Documents</option>
                  <option value="docx">Word (DOCX)</option>
                  <option value="xlsx">Excel (XLSX)</option>
                  <option value="csv">CSV Tables</option>
                  <option value="website">Public Websites</option>
                  <option value="manual">Manual Notes</option>
                </select>

                <select
                  value={sourceStatusFilter}
                  onChange={(e) => setSourceStatusFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="COMPLETED">Extracted</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>
            </div>

            {/* Sources Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              {sourcesLoading ? (
                <div className="py-20 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
                  <p className="text-xs">Loading knowledge sources...</p>
                </div>
              ) : sources.length === 0 ? (
                <div className="py-16 text-center p-6">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">No knowledge sources configured</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-5">
                    Upload your product brochures, pricing sheets, or add your company website to train AI call intelligence.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowUploadModal(true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                    >
                      Upload First Document
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWebsiteModal(true)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                    >
                      Add Website URL
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                        <th className="px-5 py-3.5">Source Title & Details</th>
                        <th className="px-4 py-3.5">Format</th>
                        <th className="px-4 py-3.5">Associated Product</th>
                        <th className="px-4 py-3.5">Extraction Status</th>
                        <th className="px-4 py-3.5 text-right">Words Extracted</th>
                        <th className="px-4 py-3.5 text-right">Date Added</th>
                        <th className="px-5 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sources.map((source) => (
                        <tr key={source._id} className="hover:bg-slate-50/60 transition">
                          <td className="px-5 py-3.5 font-medium text-slate-900">
                            <div className="flex items-center gap-2.5">
                              <div>
                                <p className="font-bold text-slate-900 line-clamp-1">{source.title}</p>
                                {source.websiteDetails?.url ? (
                                  <a
                                    href={source.websiteDetails.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1"
                                  >
                                    <span>{source.websiteDetails.domain || source.websiteDetails.url}</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                ) : source.fileDetails?.originalFileName ? (
                                  <span className="text-[11px] text-slate-400">
                                    {source.fileDetails.originalFileName} (
                                    {Math.round((source.fileDetails.fileSize || 0) / 1024)} KB)
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">Manual Entry</span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">{renderSourceTypeBadge(source.sourceType)}</td>

                          <td className="px-4 py-3.5">
                            {source.productName ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                                <Package className="w-3 h-3 text-slate-400" />
                                {source.productName}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">General Business</span>
                            )}
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="space-y-1">
                              {renderStatusBadge(source.status)}
                              {source.errorMessage && (
                                <p className="text-[10px] text-rose-600 max-w-xs truncate" title={source.errorMessage}>
                                  {source.errorMessage}
                                </p>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-700">
                            {source.wordCount ? source.wordCount.toLocaleString() : "0"}
                          </td>

                          <td className="px-4 py-3.5 text-right text-slate-400 text-[11px]">
                            {source.createdAt ? new Date(source.createdAt).toLocaleDateString() : "—"}
                          </td>

                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {source.status === "COMPLETED" && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPreview(source)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Preview</span>
                                </button>
                              )}

                              {source.status === "FAILED" && (
                                <button
                                  type="button"
                                  disabled={retryingId === source._id}
                                  onClick={() => handleRetrySource(source)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition cursor-pointer disabled:opacity-50"
                                >
                                  <RotateCw
                                    className={`w-3 h-3 ${retryingId === source._id ? "animate-spin" : ""}`}
                                  />
                                  <span>Retry</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={deletingId === source._id}
                                onClick={() => handleDeleteSource(source)}
                                title="Remove Source"
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==========================================
            TAB 4: AI KEYWORDS & TOPICS (PHASE 2)
        ========================================== */}
        {activeTab === "keywords" && (
          <AIKeywordsTab
            products={products}
            sources={sources}
            profile={profileForm}
          />
        )}
      </div>

      {/* ========================================================
          MODAL 1: ADD / EDIT PRODUCT & SERVICE
      ======================================================== */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? "Edit Product / Service" : "Add New Product or Service"}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Type</label>
                  <select
                    value={productForm.type}
                    onChange={(e) => setProductForm({ ...productForm, type: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="PRODUCT">PRODUCT</option>
                    <option value="SERVICE">SERVICE</option>
                  </select>
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                    placeholder="e.g. Living Room, Interior Design"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="e.g. Teak Wood Dining Set"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Price Row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Price (Amount)</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.price.amount}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        price: { ...productForm.price, amount: Number(e.target.value) },
                      })
                    }
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Currency</label>
                  <input
                    type="text"
                    value={productForm.price.currency}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        price: { ...productForm.price, currency: e.target.value.toUpperCase() },
                      })
                    }
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Billing Cycle</label>
                  <select
                    value={productForm.price.billingCycle}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        price: { ...productForm.price, billingCycle: e.target.value },
                      })
                    }
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="one-time">One-time</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  placeholder="Key specifications, warranty, materials used..."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Features (one per line)
                </label>
                <textarea
                  rows={2}
                  value={productForm.featuresText}
                  onChange={(e) => setProductForm({ ...productForm, featuresText: e.target.value })}
                  placeholder="Solid Burma Teak&#10;5-Year Termite Warranty&#10;Free Pan-India Delivery"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={productSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {productSaving ? "Saving..." : editingProduct ? "Update Product" : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: UPLOAD KNOWLEDGE DOCUMENT (PDF/DOCX/XLSX/CSV)
      ======================================================== */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <UploadCloud className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Upload Knowledge Document</h3>
                  <p className="text-xs text-slate-500">PDF, Word (DOCX/DOC), Excel (XLSX/XLS), CSV, TXT (Max 25MB)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Select Document File <span className="text-rose-500">*</span>
                </label>
                <input
                  type="file"
                  required
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setUploadFileObj(f)
                      if (!uploadTitle) setUploadTitle(f.name.replace(/\.[^/.]+$/, ""))
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Document Title</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. 2026 Product Catalog & Warranty Guide"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Associate with Specific Product / Service (Optional)
                </label>
                <select
                  value={uploadProductId}
                  onChange={(e) => setUploadProductId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="none">General Business Knowledge (No specific product)</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      [{p.type}] {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">Server-Side Extraction Guarantee:</p>
                <p>• Plain text content will be extracted and indexed immediately upon upload.</p>
                <p>• Binary files are validated, sanitized, and stored securely.</p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFileObj}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Extracting Content...</span>
                    </>
                  ) : (
                    <span>Upload & Extract</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 3: ADD WEBSITE URL (SSRF PROTECTED)
      ======================================================== */}
      {showWebsiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add Public Website URL</h3>
                  <p className="text-xs text-slate-500">Extracts public text from your company or product page</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWebsiteModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleWebsiteSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Public Website URL <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com/about-us"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Source Title (Optional)</label>
                <input
                  type="text"
                  value={websiteTitle}
                  onChange={(e) => setWebsiteTitle(e.target.value)}
                  placeholder="e.g. Official Company Website - Pricing Page"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Associate with Specific Product / Service (Optional)
                </label>
                <select
                  value={websiteProductId}
                  onChange={(e) => setWebsiteProductId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="none">General Business Knowledge</option>
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>
                      [{p.type}] {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* SSRF Protection Notice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                <div className="flex items-center gap-1 font-bold text-amber-950">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                  <span>Strict SSRF Security Protection Enforced:</span>
                </div>
                <p>• Only publicly accessible HTTP/HTTPS web endpoints are allowed.</p>
                <p>• Localhost, internal private IP ranges, and cloud metadata ports are strictly blocked.</p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowWebsiteModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={fetchingWebsite || !websiteUrl}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {fetchingWebsite ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Fetching & Extracting...</span>
                    </>
                  ) : (
                    <span>Extract Website Content</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 4: ADD MANUAL KNOWLEDGE NOTE
      ======================================================== */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add Manual Knowledge Note</h3>
                  <p className="text-xs text-slate-500">Directly enter FAQs, pricing rules, or business guidelines</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Note Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g. Return Policy & 30-Day Money Back Guarantee"
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                    placeholder="e.g. Policies, Pricing FAQ"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Associated Product</label>
                  <select
                    value={manualProductId}
                    onChange={(e) => setManualProductId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="none">General Business Knowledge</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        [{p.type}] {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Knowledge Content <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={6}
                  required
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Enter detailed instructions, warranty terms, product dimensions, answers to frequent client objections..."
                  className="w-full border border-slate-200 rounded-lg p-3 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingManual || !manualTitle || !manualContent}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {savingManual ? "Saving..." : "Save Knowledge Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 5: EXTRACTED TEXT PREVIEW DRAWER
      ======================================================== */}
      {showPreviewModal && selectedSourceForPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedSourceForPreview.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    {renderSourceTypeBadge(selectedSourceForPreview.sourceType)}
                    <span className="text-[11px] text-slate-500 font-mono">
                      {selectedSourceForPreview.wordCount?.toLocaleString() || 0} words (
                      {selectedSourceForPreview.textLength?.toLocaleString() || 0} chars)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyExtractedText}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 transition cursor-pointer"
                >
                  {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedText ? "Copied" : "Copy Text"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Extracted Content View */}
            <div className="flex-1 overflow-y-auto py-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto select-text">
                {selectedSourceForPreview.extractedText || "No text content available."}
              </div>

              {/* Metadata Info Footer */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-slate-100/60 p-3 rounded-xl text-slate-600">
                <div>
                  <span className="text-slate-400 block">Product:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedSourceForPreview.productName || "General"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Format:</span>
                  <span className="font-semibold uppercase text-slate-800">
                    {selectedSourceForPreview.sourceType}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Extracted At:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedSourceForPreview.lastExtractedAt
                      ? new Date(selectedSourceForPreview.lastExtractedAt).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Pages / Sheets:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedSourceForPreview.metadata?.pageCount ||
                      selectedSourceForPreview.metadata?.sheetNames?.length ||
                      "—"}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

