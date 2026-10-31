const fs = require('fs');
let content = fs.readFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', 'utf8');

// Add the missing closing </div> before line 2706
const target = `                <div className="flex justify-between">
                  <span>Last Success:</span>
                  <span className="font-semibold text-emerald-700">
                    {stats.lastSuccessAt ? new Date(stats.lastSuccessAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}`;

const replacement = `                <div className="flex justify-between">
                  <span>Last Success:</span>
                  <span className="font-semibold text-emerald-700">
                    {stats.lastSuccessAt ? new Date(stats.lastSuccessAt).toLocaleString() : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}`;

let normalized = content.replace(/\r\n/g, '\n');
let t = target.replace(/\r\n/g, '\n');
let r = replacement.replace(/\r\n/g, '\n');

if (!normalized.includes(t)) {
  console.error('Target not found!');
  process.exit(1);
}

normalized = normalized.replace(t, r);
fs.writeFileSync('frontend/app/settings/lead-feeds/lead-feeds-client.jsx', normalized, 'utf8');
console.log('Added missing closing </div>');

