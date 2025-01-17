(ns dirac.background.core
  (:require-macros [cljs.core.async.macros :refer [go go-loop]])
  (:require [goog.string :as gstring]
            [goog.string.format]
            [cljs.core.async :refer [<! chan]]
            [chromex.support :refer-macros [oget ocall oapply]]
            [chromex.logging :refer-macros [log info warn error group group-end]]
            [chromex.chrome-event-channel :refer [make-chrome-event-channel]]
            [chromex.protocols :refer [post-message! get-sender]]
            [chromex.ext.runtime :as runtime]
            [chromex.ext.windows :as windows]
            [chromex.ext.tabs :as tabs]
            [chromex.ext.browser-action :as browser-action]
            [chromex.ext.commands :as commands]
            [dirac.background.cors :refer [setup-cors-rewriting!]]
            [dirac.target.core :refer [resolve-backend-url]]
            [dirac.background.state :refer [state]]
            [dirac.background.connections :as connections]
            [dirac.options.model :as options]
            [dirac.background.tools :as tools]))

(defn handle-command! [command]
  (case command
    "open-dirac-devtools" (tools/open-dirac-in-active-tab!)
    (warn "Received unrecognized command:" command)))

(defn on-tab-removed! [tab-id _remove-info]
  (if (connections/dirac-connected? tab-id)
    (connections/unregister-connection! tab-id)))

(defn on-tab-updated! [tab-id _change-info _tab]
  (connections/update-action-button-according-to-connection-state! tab-id))

; -- main event loop --------------------------------------------------------------------------------------------------------

(defn process-chrome-event [event-num event]
  (log (gstring/format "BACKGROUND: got chrome event (%05d)" event-num) event)
  (let [[event-id event-args] event]
    (case event-id
      ::browser-action/on-clicked (apply tools/activate-or-open-dirac! event-args)
      ::commands/on-command (apply handle-command! event-args)
      ::tabs/on-removed (apply on-tab-removed! event-args)
      ::tabs/on-updated (apply on-tab-updated! event-args)
      nil)))

(defn run-chrome-event-loop! [chrome-event-channel]
  (log "BACKGROUND: starting main event loop...")
  (go-loop [event-num 1]
    (when-let [event (<! chrome-event-channel)]
      (process-chrome-event event-num event)
      (recur (inc event-num)))
    (log "BACKGROUND: leaving main event loop")))

(defn boot-chrome-event-loop! []
  (let [chrome-event-channel (make-chrome-event-channel (chan))]
    (tabs/tap-all-events chrome-event-channel)
    (runtime/tap-all-events chrome-event-channel)
    (browser-action/tap-on-clicked-events chrome-event-channel)
    (commands/tap-on-command-events chrome-event-channel)
    (run-chrome-event-loop! chrome-event-channel)))

; -- main entry point -------------------------------------------------------------------------------------------------------

(defn init! []
  (log "BACKGROUND: init")
  (setup-cors-rewriting!)
  (go
    (<! (options/init!))
    (boot-chrome-event-loop!)))