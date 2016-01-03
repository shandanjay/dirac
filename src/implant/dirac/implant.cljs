(ns dirac.implant
  (:require [dirac.dev]
            [dirac.implant.editor :as editor]
            [dirac.implant.intercom :as intercom]
            [chromex.logging :refer-macros [log warn error]]))

(def ^:dynamic *initialized* false)

(defn ^:export init []
  (when-not *initialized*
    (set! *initialized* true)
    (intercom/connect-to-weasel-server "ws://localhost:9001")                                                                 ; TODO: customize URL
    (intercom/connect-to-nrepl-tunnel-server "ws://localhost:9050")))                                                         ; TODO: customize URL

(defn ^:export adopt-prompt-element [text-area-element use-parinfer?]
  (let [editor (editor/create-editor! text-area-element :prompt use-parinfer?)]
    (editor/start-editor-sync!)
    editor))

(defn ^:export send-eval-request [request-id code]
  (intercom/send-eval-request! request-id code))