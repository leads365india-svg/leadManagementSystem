const fs = require('fs');
const filePath = 'frontend/app/settings/lead-feeds/lead-feeds-client.jsx';
let content = fs.readFileSync(filePath, 'utf8');

const targetWebsiteTab = `      {/* ========================================================
          TAB 1: WEBSITE FORMS & REST WEBHOOK
      ======================================================== */}
      {activeTab === "website" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">`;

const websiteStudioUI = `      {/* ========================================================
          TAB 1: WEBSITE FORMS & REST WEBHOOK
      ======================================================== */}
      {activeTab === "website" && (
        <div className="space-y-8">
          {/* Website Integrations Studio Header */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Website Lead Integrations</h2>
                    <p className="text-xs text-slate-500">
                      Receive leads automatically from any external website platform (WordPress, HTML/JS, PHP, React, Next.js, or Webhooks).
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreatedIntegrationCredentials(null)
                    setShowCreateModal(true)
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add Website Integration
                </button>
              </div>
            </div>

            {/* Platform Filter Tabs */}
            <div className="flex items-center gap-2 pt-4 overflow-x-auto pb-1">
              {[
                { id: "all", label: "All Integrations", count: websiteIntegrations.length },
                { id: "wordpress", label: "WordPress", count: websiteIntegrations.filter((i) => i.type === "wordpress").length },
                { id: "html", label: "HTML / JS", count: websiteIntegrations.filter((i) => i.type === "html" || i.type === "website").length },
                { id: "php", label: "PHP", count: websiteIntegrations.filter((i) => i.type === "php").length },
                { id: "react", label: "React", count: websiteIntegrations.filter((i) => i.type === "react").length },
                { id: "nextjs", label: "Next.js", count: websiteIntegrations.filter((i) => i.type === "nextjs").length },
                { id: "webhook", label: "Webhooks", count: websiteIntegrations.filter((i) => i.type === "webhook" || i.type === "generic").length },
              ].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSelectedPlatformFilter(filter.id)}
                  className={\`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer \${
                    selectedPlatformFilter === filter.id
                      ? "bg-slate-900 text-white font-semibold"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }\`}
                >
                  <span>{filter.label}</span>
                  <span className={\`text-[10px] px-1.5 py-0.2 rounded-full \${
                    selectedPlatformFilter === filter.id ? "bg-slate-700 text-slate-200" : "bg-slate-200 text-slate-600"
                  }\`}>
                    {filter.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Integrations List Grid */}
            <div className="mt-6">
              {loadingIntegrations ? (
                <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading website integrations...
                </div>
              ) : websiteIntegrations.length === 0 ? (
                <div className="py-12 px-6 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <Globe className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-800">No Website Integrations Yet</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                    Connect your WordPress, React, Next.js, PHP, or HTML website to ingest leads seamlessly into Leads-365 CRM.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedIntegrationCredentials(null)
                      setShowCreateModal(true)
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Connect Your First Website
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {websiteIntegrations
                    .filter((item) => {
                      if (selectedPlatformFilter === "all") return true
                      if (selectedPlatformFilter === "html") return item.type === "html" || item.type === "website"
                      if (selectedPlatformFilter === "webhook") return item.type === "webhook" || item.type === "generic"
                      return item.type === selectedPlatformFilter
                    })
                    .map((item) => {
                      const isItemActive = item.status === "active"
                      return (
                        <div
                          key={item.id || item._id}
                          className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs uppercase">
                                  {item.type?.slice(0, 2) || "WB"}
                                </div>
                                <div>
                                  <h4 className="text-sm font-bold text-slate-900 leading-tight">{item.name}</h4>
                                  <span className="text-[11px] text-slate-400 capitalize">{item.type} Integration</span>
                                </div>
                              </div>
                              <span
                                className={\`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold \${
                                  isItemActive
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : "bg-slate-100 text-slate-600 border border-slate-200"
                                }\`}
                              >
                                <span className={\`w-1.5 h-1.5 rounded-full \${isItemActive ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}\`} />
                                {isItemActive ? "Active" : "Disabled"}
                              </span>
                            </div>

                            <div className="space-y-1.5 my-3 bg-slate-50 p-2.5 rounded-lg text-[11px] border border-slate-100">
                              <div className="flex items-center justify-between text-slate-600">
                                <span className="font-mono text-slate-400">Domain:</span>
                                <span className="font-medium truncate max-w-[160px]">{item.settings?.websiteDomain || "All origins"}</span>
                              </div>
                              {item.siteKey && (
                                <div className="flex items-center justify-between text-slate-600">
                                  <span className="font-mono text-slate-400">Site Key:</span>
                                  <span className="font-mono text-indigo-600 truncate max-w-[160px]">{item.siteKey}</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between text-slate-600">
                                <span className="font-mono text-slate-400">Received / Success:</span>
                                <span className="font-semibold text-slate-700">
                                  {item.stats?.totalReceived || 0} / {item.stats?.totalSuccess || 0}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenSnippets(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-medium transition cursor-pointer"
                                title="View Code Snippets & Instructions"
                              >
                                <Code2 className="w-3.5 h-3.5" />
                                Code
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenMapping(item)}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition cursor-pointer"
                                title="Configure Field Mapping"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                Mapping
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenTest(item)}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-medium transition cursor-pointer"
                                title="Send Test Lead"
                              >
                                <PlayCircle className="w-3.5 h-3.5" />
                                Test
                              </button>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleToggleIntegrationStatus(item)}
                                className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                                title={isItemActive ? "Disable Integration" : "Activate Integration"}
                              >
                                <Shield className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRotateIntegrationKey(item)}
                                className="p-1.5 rounded-md text-amber-500 hover:text-amber-700 hover:bg-amber-50 transition cursor-pointer"
                                title="Rotate API Key"
                              >
                                <RotateCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteIntegration(item)}
                                className="p-1.5 rounded-md text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                title="Deactivate / Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Legacy Global Feed Settings Accordion */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">`;

const modalsUI = `
      {/* ========================================================
          MODAL 1: ADD WEBSITE INTEGRATION
      ======================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add New Website Integration</h3>
                  <p className="text-xs text-slate-500">Configure incoming lead feed from your website or app</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createdIntegrationCredentials ? (
              <div className="mt-5 space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs">
                  <div className="flex items-center gap-2 font-bold mb-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Integration Created Successfully!
                  </div>
                  <p>Save your credentials now. Your private API key will not be shown again.</p>
                </div>

                {createdIntegrationCredentials.rawApiKey && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Private API Key (Save Securely)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdIntegrationCredentials.rawApiKey}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs font-mono text-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(createdIntegrationCredentials.rawApiKey)
                          toast.success("API key copied!")
                        }}
                        className="px-3 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-medium cursor-pointer"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                {createdIntegrationCredentials.siteKey && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Public Site Key (For HTML/JS Forms)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdIntegrationCredentials.siteKey}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs font-mono text-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(createdIntegrationCredentials.siteKey)
                          toast.success("Site key copied!")
                        }}
                        className="px-3 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false)
                      setCreatedIntegrationCredentials(null)
                    }}
                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done & View Integrations
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateIntegration} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Integration Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Main Company Website"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Platform Type *</label>
                  <select
                    value={createForm.type}
                    onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none capitalize"
                  >
                    <option value="wordpress">WordPress (Elementor / CF7 / WPForms / PHP)</option>
                    <option value="html">HTML / JavaScript Static Form</option>
                    <option value="php">PHP Website (cURL / Backend)</option>
                    <option value="react">React Website / Component</option>
                    <option value="nextjs">Next.js (App Router / Server Action)</option>
                    <option value="webhook">Custom Webhook / External API</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Website Domain</label>
                    <input
                      type="text"
                      placeholder="e.g. mycompany.com"
                      value={createForm.websiteDomain}
                      onChange={(e) => setCreateForm({ ...createForm, websiteDomain: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Lead Source Label</label>
                    <input
                      type="text"
                      placeholder="e.g. WordPress, Landing Page"
                      value={createForm.leadSource}
                      onChange={(e) => setCreateForm({ ...createForm, leadSource: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Allowed Origins (for public browser forms)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="https://mycompany.com&#10;http://localhost:3000"
                    value={createForm.allowedOrigins}
                    onChange={(e) => setCreateForm({ ...createForm, allowedOrigins: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Separate origins by commas or newlines</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Default Lead Status</label>
                    <select
                      value={createForm.defaultStatus}
                      onChange={(e) => setCreateForm({ ...createForm, defaultStatus: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="New">New</option>
                      <option value="Engaged">Engaged</option>
                      <option value="Qualified">Qualified</option>
                      <option value="Proposal Sent">Proposal Sent</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Assign Incoming Leads To</label>
                    <select
                      value={createForm.assignedStaffId}
                      onChange={(e) => setCreateForm({ ...createForm, assignedStaffId: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="unassigned">Unassigned (Queue)</option>
                      {staffList.map((s) => (
                        <option key={s.id || s._id} value={s.id || s._id}>
                          {s.name} ({s.email})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingIntegration}
                    className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
                  >
                    {creatingIntegration ? "Creating..." : "Create Integration"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: CODE SNIPPETS & SETUP INSTRUCTIONS
      ======================================================== */}
      {showSnippetsModal && selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Integration Setup & Code Snippets</h3>
                  <p className="text-xs text-slate-500">
                    {selectedIntegration.name} ({selectedIntegration.type})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSnippetsModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Platform Selector Tabs inside Snippets Modal */}
            <div className="flex items-center gap-1.5 pt-4 pb-2 border-b border-slate-100 overflow-x-auto">
              {[
                { id: "wordpress", label: "WordPress" },
                { id: "html", label: "HTML / JS" },
                { id: "php", label: "PHP Backend" },
                { id: "react", label: "React" },
                { id: "nextjs", label: "Next.js" },
                { id: "webhook", label: "Custom Webhook" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSnippetTab(tab.id)}
                  className={\`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer \${
                    activeSnippetTab === tab.id
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }\`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Code & Instructions Content */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {loadingSnippets ? (
                <div className="py-16 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating integration code...
                </div>
              ) : integrationSnippets ? (
                <>
                  {activeSnippetTab === "wordpress" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="font-bold text-slate-900">WordPress Webhook URL</div>
                        <div className="font-mono text-indigo-600 select-all">{integrationSnippets.wordpress?.webhookUrl}</div>
                        {selectedIntegration.siteKey && (
                          <div className="font-mono text-slate-500 pt-1">Site Key: {selectedIntegration.siteKey}</div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="font-bold text-slate-900">Elementor Form Instructions</div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] whitespace-pre-wrap">
                          {integrationSnippets.wordpress?.elementorInstructions}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="font-bold text-slate-900">Contact Form 7 / WPForms Instructions</div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] whitespace-pre-wrap">
                          {integrationSnippets.wordpress?.cf7WebhookInstructions}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">Custom PHP Hook (functions.php)</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.wordpress?.customPhpHook || "")
                              toast.success("PHP hook code copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy PHP Hook
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.wordpress?.customPhpHook}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeSnippetTab === "html" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                        <strong>Anti-Bot Honeypot Included:</strong> The form snippet below includes a hidden honeypot trap field (<code>_hp_trap</code>) to silently discard spam bot submissions without annoying CAPTCHAs.
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">HTML Form & JavaScript Snippet</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.html?.htmlForm || "")
                              toast.success("HTML code copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy HTML Form
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.html?.htmlForm}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeSnippetTab === "php" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                        <strong>HMAC-SHA256 & Timestamp Protection:</strong> This server-to-server PHP script securely signs every payload with an HMAC-SHA256 signature and attaches timestamp and idempotency headers to guarantee authenticity and prevent replay attacks.
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">Production-Ready PHP Integration Script</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.php?.serverScript || "")
                              toast.success("PHP script copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy PHP Script
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.php?.serverScript}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeSnippetTab === "react" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">React LeadCaptureForm Component</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.react?.component || "")
                              toast.success("React component copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy React Component
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.react?.component}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeSnippetTab === "nextjs" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-900">
                        <strong>Environment Variable Security:</strong> Private API keys are strictly kept on the server inside <code>.env.local</code>. The client browser only calls your internal <code>/api/contact</code> route.
                      </div>

                      <div className="space-y-2">
                        <div className="font-bold text-slate-900">1. .env.local Configuration</div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px]">
                          {integrationSnippets.nextjs?.envExample}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">2. App Router Server Route (app/api/contact/route.js)</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.nextjs?.routeHandler || "")
                              toast.success("Route handler copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy Server Handler
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.nextjs?.routeHandler}
                        </pre>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">3. Client Form Component (app/components/ContactForm.jsx)</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.nextjs?.clientComponent || "")
                              toast.success("Client form copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy Client Form
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.nextjs?.clientComponent}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeSnippetTab === "webhook" && (
                    <div className="space-y-4 text-xs text-slate-700">
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="font-bold text-slate-900">Webhook Endpoint URL</div>
                        <div className="font-mono text-indigo-600 select-all">{integrationSnippets.webhook?.webhookUrl}</div>
                        <div className="text-[11px] text-slate-500 pt-1">HTTP Method: POST | Content-Type: application/json</div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">cURL Example</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(integrationSnippets.webhook?.curlExample || "")
                              toast.success("cURL command copied!")
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Copy cURL
                          </button>
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] overflow-x-auto">
                          {integrationSnippets.webhook?.curlExample}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-8 text-center text-slate-500 text-xs">Could not load snippets</div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSnippetsModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 3: FIELD MAPPING CONFIGURATION
      ======================================================== */}
      {showMappingModal && selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Lead Field Mapping</h3>
                  <p className="text-xs text-slate-500">
                    Map incoming website form fields to CRM lead fields for {selectedIntegration.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              <p className="text-xs text-slate-500">
                Define how external form fields match CRM attributes. Custom fields (e.g. <code>product</code>, <code>budget</code>) are saved into lead metadata.
              </p>

              <div className="space-y-2">
                {editingMappings.map((map, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                    <input
                      type="text"
                      placeholder="Source field (e.g. full_name)"
                      value={map.sourceField}
                      onChange={(e) => {
                        const copy = [...editingMappings]
                        copy[idx].sourceField = e.target.value
                        setEditingMappings(copy)
                      }}
                      className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-xs bg-white font-mono"
                    />
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="CRM field (name, email, phone...)"
                      value={map.targetField}
                      onChange={(e) => {
                        const copy = [...editingMappings]
                        copy[idx].targetField = e.target.value
                        setEditingMappings(copy)
                      }}
                      className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-xs bg-white font-mono"
                    />
                    <select
                      value={map.transform || "none"}
                      onChange={(e) => {
                        const copy = [...editingMappings]
                        copy[idx].transform = e.target.value
                        setEditingMappings(copy)
                      }}
                      className="border border-slate-200 rounded px-2 py-1.5 text-xs bg-white text-slate-700"
                    >
                      <option value="none">No transform</option>
                      <option value="trim">Trim</option>
                      <option value="lowercase">Lowercase</option>
                      <option value="uppercase">Uppercase</option>
                      <option value="phone_e164">Phone E.164</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMappings(editingMappings.filter((_, i) => i !== idx))
                      }}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded cursor-pointer"
                      title="Remove field mapping"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingMappings([
                    ...editingMappings,
                    { sourceField: "", targetField: "", transform: "trim", defaultValue: "" },
                  ])
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 text-xs font-semibold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Field Rule
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowMappingModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingMappings}
                onClick={handleSaveMapping}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {savingMappings ? "Saving..." : "Save Field Mappings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 4: TEST INTEGRATION SIMULATION
      ======================================================== */}
      {showTestModal && selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                  <PlayCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Test Website Integration</h3>
                  <p className="text-xs text-slate-500">Simulate incoming lead payload for {selectedIntegration.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Test JSON Payload</label>
                <textarea
                  rows={7}
                  value={testPayloadText}
                  onChange={(e) => setTestPayloadText(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-3 text-xs font-mono bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {integrationTestResult && (
                <div className="p-4 bg-slate-900 text-slate-100 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                    <span>Simulation Result</span>
                    <span>HTTP 200 OK</span>
                  </div>
                  <pre className="text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(integrationTestResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={testingIntegration}
                onClick={handleRunTest}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                {testingIntegration ? "Sending Simulation..." : "Send Test Lead"}
              </button>
            </div>
          </div>
        </div>
      )}
`;

let normalized = content.replace(/\r\n/g, '\n');
let targetNormalized = targetWebsiteTab.replace(/\r\n/g, '\n');
let replacementNormalized = websiteStudioUI.replace(/\r\n/g, '\n');

if (!normalized.includes(targetNormalized)) {
  console.error('Target website tab not found!');
  process.exit(1);
}

// 1. Replace the tab start
normalized = normalized.replace(targetNormalized, replacementNormalized);

// 2. Add the 4 modals right before the final closing </div> of LeadFeedsClient
const closeTarget = `    </div>
  )
}`;

const closeReplacement = `${modalsUI}
    </div>
  )
}`;

let ct = closeTarget.replace(/\r\n/g, '\n');
let cr = closeReplacement.replace(/\r\n/g, '\n');

if (!normalized.includes(ct)) {
  console.error('Close target not found!');
  process.exit(1);
}

normalized = normalized.replace(ct, cr);

fs.writeFileSync(filePath, normalized, 'utf8');
console.log('Successfully patched lead-feeds-client.jsx with Website Integrations Studio & Modals!');

