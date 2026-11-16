# Changelog

## 0.2.0

- Add read-only reported capability snapshots, effective capabilities, reported energy encoding, per-mode temperature limits and separate feature flags. Missing reports remain null, and returned objects cannot mutate library state. Existing commands, polling and decoder defaults are unchanged.

## 0.1.3

- Reassemble V2 TCP packets across fragmented reads and preserve every packet when reads contain multiple replies.
- Validate frame headers, lengths, AC response sizes and TLV bounds before parsing state.
- Ignore rejected property values, expose their result codes through `PropertiesResponse.failedProperties`, and reject failed property writes without clearing pending changes.
- Maintain the ENERGY_STATS capability independently from forced energy polling.
- Decode binary energy counters as unsigned 32-bit numbers.
- Reject AC and CC writes on transport errors, empty replies or unusable responses while retaining tolerant status polling. A compound write may partially succeed; errors do not roll back device changes.
- Normalize exhausted LAN retries and connection timeouts to ProtocolError and mark failed transports offline.
- Refresh the stale lockfile to match the existing Node.js type dependency range.
