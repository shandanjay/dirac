/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @constructor
 * @extends {WebInspector.SDKModel}
 * @param {!WebInspector.Target} target
 */
WebInspector.ConsoleModel = function(target)
{
    WebInspector.SDKModel.call(this, WebInspector.ConsoleModel, target);

    /** @type {!Array.<!WebInspector.ConsoleMessage>} */
    this._messages = [];
    /** @type {!Map<number, !WebInspector.ConsoleMessage>} */
    this._messageById = new Map();
    this._warnings = 0;
    this._errors = 0;
    this._revokedErrors = 0;
    this._consoleAgent = target.consoleAgent();
    target.registerConsoleDispatcher(new WebInspector.DiracAwareConsoleDispatcher(this));
    this._enableAgent();
}

WebInspector.ConsoleModel.Events = {
    ConsoleCleared: "ConsoleCleared",
    DiracMessage: "DiracMessage",
    MessageAdded: "MessageAdded",
    MessageUpdated: "MessageUpdated",
    CommandEvaluated: "CommandEvaluated",
}

WebInspector.ConsoleModel.prototype = {
    _enableAgent: function()
    {
        this._enablingConsole = true;

        /**
         * @this {WebInspector.ConsoleModel}
         */
        function callback()
        {
            delete this._enablingConsole;
        }
        this._consoleAgent.enable(callback.bind(this));
    },

    /**
     * @param {!WebInspector.ConsoleMessage} msg
     */
    addMessage: function(msg)
    {
        if (this._isBlacklisted(msg))
            return;

        if (msg.level === WebInspector.ConsoleMessage.MessageLevel.RevokedError && msg._relatedMessageId) {
            var relatedMessage = this._messageById.get(msg._relatedMessageId);
            if (!relatedMessage)
                return;
            this._errors--;
            this._revokedErrors++;
            relatedMessage.level = WebInspector.ConsoleMessage.MessageLevel.RevokedError;
            this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.MessageUpdated, relatedMessage);
            return;
        }

        this._messages.push(msg);
        if (msg._messageId)
            this._messageById.set(msg._messageId, msg);
        this._incrementErrorWarningCount(msg);
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.MessageAdded, msg);
    },

    dispatchDiracMessage: function(msg) {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.DiracMessage, msg);
    },

    /**
     * @param {!WebInspector.ConsoleMessage} msg
     */
    _incrementErrorWarningCount: function(msg)
    {
        switch (msg.level) {
            case WebInspector.ConsoleMessage.MessageLevel.Warning:
                this._warnings++;
                break;
            case WebInspector.ConsoleMessage.MessageLevel.Error:
                this._errors++;
                break;
            case WebInspector.ConsoleMessage.MessageLevel.RevokedError:
                this._revokedErrors++;
                break;
        }
    },

    /**
     * @param {!WebInspector.ConsoleMessage} msg
     * @return {boolean}
     */
    _isBlacklisted: function(msg)
    {
        if (msg.source != WebInspector.ConsoleMessage.MessageSource.Network || msg.level != WebInspector.ConsoleMessage.MessageLevel.Error || !msg.url || !msg.url.startsWith("chrome-extension"))
            return false;

        // ignore Chromecast's cast_sender spam
        if (msg.url.includes("://boadgeojelhgndaghljhdicfkmllpafd") ||  msg.url.includes("://dliochdbjfkdbacpmhlcpmleaejidimm") ||  msg.url.includes("://pkedcjkdefgpdelpbcmbmeomcjbeemfm") || msg.url.includes("://fjhoaacokmgbjemoflkofnenfaiekifl") || msg.url.includes("://ekpaaapppgpmolpcldedioblbkmijaca"))
            return true;

        return false;
    },

    /**
     * @return {!Array.<!WebInspector.ConsoleMessage>}
     */
    messages: function()
    {
        return this._messages;
    },

    requestClearMessages: function()
    {
        this._consoleAgent.clearMessages();
        this._messagesCleared();
    },

    _messagesCleared: function()
    {
        this._messages = [];
        this._messageById.clear();
        this._errors = 0;
        this._revokedErrors = 0;
        this._warnings = 0;
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.ConsoleCleared);
    },

    /**
     * @return {number}
     */
    errors: function()
    {
        return this._errors;
    },

    /**
     * @return {number}
     */
    revokedErrors: function()
    {
        return this._revokedErrors;
    },

    /**
     * @return {number}
     */
    warnings: function()
    {
        return this._warnings;
    },

    __proto__: WebInspector.SDKModel.prototype
}

/**
 * @param {!WebInspector.ExecutionContext} executionContext
 * @param {string} text
 * @param {boolean=} useCommandLineAPI
 */
WebInspector.ConsoleModel.evaluateCommandInConsole = function(executionContext, text, useCommandLineAPI)
{
    var target = executionContext.target();

    var commandMessage = new WebInspector.ConsoleMessage(target, WebInspector.ConsoleMessage.MessageSource.JS, null, text, WebInspector.ConsoleMessage.MessageType.Command);
    commandMessage.setExecutionContextId(executionContext.id);
    target.consoleModel.addMessage(commandMessage);

    /**
     * @param {?WebInspector.RemoteObject} result
     * @param {boolean} wasThrown
     * @param {?RuntimeAgent.RemoteObject=} valueResult
     * @param {?RuntimeAgent.ExceptionDetails=} exceptionDetails
     */
    function printResult(result, wasThrown, valueResult, exceptionDetails)
    {
        if (!result)
            return;

        WebInspector.console.showPromise().then(reportUponEvaluation);
        function reportUponEvaluation()
        {
            target.consoleModel.dispatchEventToListeners(WebInspector.ConsoleModel.Events.CommandEvaluated, {result: result, wasThrown: wasThrown, text: text, commandMessage: commandMessage, exceptionDetails: exceptionDetails});
        }
    }
    if (/^\s*\{/.test(text) && /\}\s*$/.test(text))
        text = '(' + text + ')';
    executionContext.evaluate(text, "console", !!useCommandLineAPI, false, false, true, printResult);

    WebInspector.userMetrics.actionTaken(WebInspector.UserMetrics.Action.ConsoleEvaluated);
}

WebInspector.ConsoleModel.clearConsole = function()
{
    var targets = WebInspector.targetManager.targets();
    for (var i = 0; i < targets.length; ++i)
        targets[i].consoleModel.requestClearMessages();
}


/**
 * @constructor
 * @param {?WebInspector.Target} target
 * @param {string} source
 * @param {?string} level
 * @param {string} messageText
 * @param {string=} type
 * @param {?string=} url
 * @param {number=} line
 * @param {number=} column
 * @param {!NetworkAgent.RequestId=} requestId
 * @param {!Array.<!RuntimeAgent.RemoteObject>=} parameters
 * @param {!RuntimeAgent.StackTrace=} stackTrace
 * @param {number=} timestamp
 * @param {!RuntimeAgent.ExecutionContextId=} executionContextId
 * @param {?string=} scriptId
 * @param {number=} messageId
 * @param {number=} relatedMessageId
 */
WebInspector.ConsoleMessage = function(target, source, level, messageText, type, url, line, column, requestId, parameters, stackTrace, timestamp, executionContextId, scriptId, messageId, relatedMessageId)
{
    this._target = target;
    this.source = source;
    this.level = level;
    this.messageText = messageText;
    this.type = type || WebInspector.ConsoleMessage.MessageType.Log;
    /** @type {string|undefined} */
    this.url = url || undefined;
    /** @type {number} */
    this.line = line || 0;
    /** @type {number} */
    this.column = column || 0;
    this.parameters = parameters;
    /** @type {!RuntimeAgent.StackTrace|undefined} */
    this.stackTrace = stackTrace;
    this.timestamp = timestamp || Date.now();
    this.executionContextId = executionContextId || 0;
    this.scriptId = scriptId || null;
    this._messageId = messageId || 0;
    this._relatedMessageId = relatedMessageId || 0;

    this.request = requestId ? target.networkLog.requestForId(requestId) : null;

    if (this.request) {
        var initiator = this.request.initiator();
        if (initiator) {
            this.stackTrace = initiator.stack || undefined;
            if (initiator.url) {
                this.url = initiator.url;
                this.line = initiator.lineNumber || 0;
            }
        }
    }
}

WebInspector.ConsoleMessage.prototype = {
    /**
     * @return {?WebInspector.Target}
     */
    target: function()
    {
        return this._target;
    },

    /**
     * @param {!WebInspector.ConsoleMessage} originatingMessage
     */
    setOriginatingMessage: function(originatingMessage)
    {
        this._originatingConsoleMessage = originatingMessage;
        this.executionContextId = originatingMessage.executionContextId;
    },

    /**
     * @param {!RuntimeAgent.ExecutionContextId} executionContextId
     */
    setExecutionContextId: function(executionContextId)
    {
        this.executionContextId = executionContextId;
    },

    /**
     * @return {?WebInspector.ConsoleMessage}
     */
    originatingMessage: function()
    {
        return this._originatingConsoleMessage;
    },

    /**
     * @return {boolean}
     */
    isGroupMessage: function()
    {
        return this.type === WebInspector.ConsoleMessage.MessageType.StartGroup ||
            this.type === WebInspector.ConsoleMessage.MessageType.StartGroupCollapsed ||
            this.type === WebInspector.ConsoleMessage.MessageType.EndGroup;
    },

    /**
     * @return {boolean}
     */
    isGroupStartMessage: function()
    {
        return this.type === WebInspector.ConsoleMessage.MessageType.StartGroup ||
            this.type === WebInspector.ConsoleMessage.MessageType.StartGroupCollapsed;
    },

    /**
     * @return {boolean}
     */
    isErrorOrWarning: function()
    {
        return (this.level === WebInspector.ConsoleMessage.MessageLevel.Warning || this.level === WebInspector.ConsoleMessage.MessageLevel.Error);
    },

    /**
     * @param {?WebInspector.ConsoleMessage} msg
     * @return {boolean}
     */
    isEqual: function(msg)
    {
        if (!msg)
            return false;

        if (this._messageId || msg._messageId)
            return false;
        if (this._relatedMessageId || msg._relatedMessageId)
            return false;

        if (!this._isEqualStackTraces(this.stackTrace, msg.stackTrace))
            return false;

        if (this.parameters) {
            if (!msg.parameters || this.parameters.length !== msg.parameters.length)
                return false;

            for (var i = 0; i < msg.parameters.length; ++i) {
                // Never treat objects as equal - their properties might change over time.
                if (this.parameters[i].type !== msg.parameters[i].type || msg.parameters[i].type === "object" || this.parameters[i].value !== msg.parameters[i].value)
                    return false;
            }
        }

        return (this.target() === msg.target())
            && (this.source === msg.source)
            && (this.type === msg.type)
            && (this.level === msg.level)
            && (this.line === msg.line)
            && (this.url === msg.url)
            && (this.messageText === msg.messageText)
            && (this.request === msg.request)
            && (this.executionContextId === msg.executionContextId)
            && (this.scriptId === msg.scriptId);
    },

    /**
     * @param {!RuntimeAgent.StackTrace|undefined} stackTrace1
     * @param {!RuntimeAgent.StackTrace|undefined} stackTrace2
     * @return {boolean}
     */
    _isEqualStackTraces: function(stackTrace1, stackTrace2)
    {
        if (!stackTrace1 !== !stackTrace2)
            return false;
        if (!stackTrace1)
            return true;
        var callFrames1 = stackTrace1.callFrames;
        var callFrames2 = stackTrace2.callFrames;
        if (callFrames1.length !== callFrames2.length)
            return false;
        for (var i = 0, n = callFrames1.length; i < n; ++i) {
            if (callFrames1[i].url !== callFrames2[i].url ||
                callFrames1[i].functionName !== callFrames2[i].functionName ||
                callFrames1[i].lineNumber !== callFrames2[i].lineNumber ||
                callFrames1[i].columnNumber !== callFrames2[i].columnNumber)
                return false;
        }
        return this._isEqualStackTraces(stackTrace1.parent, stackTrace2.parent);
    }
}

// Note: Keep these constants in sync with the ones in Console.h
/**
 * @enum {string}
 */
WebInspector.ConsoleMessage.MessageSource = {
    XML: "xml",
    JS: "javascript",
    Network: "network",
    ConsoleAPI: "console-api",
    Storage: "storage",
    AppCache: "appcache",
    Rendering: "rendering",
    CSS: "css",
    Security: "security",
    Other: "other",
    Deprecation: "deprecation"
}

/**
 * @enum {string}
 */
WebInspector.ConsoleMessage.MessageType = {
    Log: "log",
    Dir: "dir",
    DirXML: "dirxml",
    Table: "table",
    Trace: "trace",
    Clear: "clear",
    StartGroup: "startGroup",
    StartGroupCollapsed: "startGroupCollapsed",
    EndGroup: "endGroup",
    Assert: "assert",
    Result: "result",
    Profile: "profile",
    ProfileEnd: "profileEnd",
    DiracCommand: "diracCommand",
    Command: "command"
}

/**
 * @enum {string}
 */
WebInspector.ConsoleMessage.MessageLevel = {
    Log: "log",
    Info: "info",
    Warning: "warning",
    Error: "error",
    Debug: "debug",
    RevokedError: "revokedError"
};

/**
 * @param {!WebInspector.ConsoleMessage} a
 * @param {!WebInspector.ConsoleMessage} b
 * @return {number}
 */
WebInspector.ConsoleMessage.timestampComparator = function (a, b)
{
    return a.timestamp - b.timestamp;
}

/**
 * @constructor
 * @implements {ConsoleAgent.Dispatcher}
 * @param {!WebInspector.ConsoleModel} console
 */
WebInspector.ConsoleDispatcher = function(console)
{
    this._console = console;
}

WebInspector.ConsoleDispatcher.prototype = {
    /**
     * @override
     * @param {!ConsoleAgent.ConsoleMessage} payload
     */
    messageAdded: function(payload)
    {
        var consoleMessage = new WebInspector.ConsoleMessage(
            this._console.target(),
            payload.source,
            payload.level,
            payload.text,
            payload.type,
            payload.url,
            payload.line,
            payload.column,
            payload.networkRequestId,
            payload.parameters,
            payload.stack,
            payload.timestamp * 1000, // Convert to ms.
            payload.executionContextId,
            payload.scriptId,
            payload.messageId,
            payload.relatedMessageId);
        this._console.addMessage(consoleMessage);
    },

    /**
     * @override
     * @param {number} count
     */
    messageRepeatCountUpdated: function(count)
    {
    },

    /**
     * @override
     */
    messagesCleared: function()
    {
        if (!WebInspector.moduleSetting("preserveConsoleLog").get())
            this._console._messagesCleared();
    }
}

WebInspector.DiracAwareConsoleDispatcher = function(console)
{
    WebInspector.ConsoleDispatcher.call(this, console);
}

WebInspector.DiracAwareConsoleDispatcher.prototype = {

    messageAdded: function(payload)
    {
        if (payload.parameters) {
            var firstParam = payload.parameters[0];
            if (firstParam && firstParam.value == "~~$DIRAC-MSG$~~") {
                return this._console.dispatchDiracMessage(payload);
            }
        }

        WebInspector.ConsoleDispatcher.prototype.messageAdded.call(this, payload);
    },

    __proto__: WebInspector.ConsoleDispatcher.prototype
}

/**
 * @constructor
 * @extends {WebInspector.Object}
 * @implements {WebInspector.TargetManager.Observer}
 */
WebInspector.MultitargetConsoleModel = function()
{
    WebInspector.targetManager.observeTargets(this);
    WebInspector.targetManager.addModelListener(WebInspector.ConsoleModel, WebInspector.ConsoleModel.Events.DiracMessage, this._consoleDiracMessage, this);
    WebInspector.targetManager.addModelListener(WebInspector.ConsoleModel, WebInspector.ConsoleModel.Events.MessageAdded, this._consoleMessageAdded, this);
    WebInspector.targetManager.addModelListener(WebInspector.ConsoleModel, WebInspector.ConsoleModel.Events.MessageUpdated, this._consoleMessageUpdated, this);
    WebInspector.targetManager.addModelListener(WebInspector.ConsoleModel, WebInspector.ConsoleModel.Events.CommandEvaluated, this._commandEvaluated, this);
}

WebInspector.MultitargetConsoleModel.prototype = {
    /**
     * @override
     * @param {!WebInspector.Target} target
     */
    targetAdded: function(target)
    {
        if (!this._mainTarget) {
            this._mainTarget = target;
            target.consoleModel.addEventListener(WebInspector.ConsoleModel.Events.ConsoleCleared, this._consoleCleared, this);
        }
    },

    /**
     * @override
     * @param {!WebInspector.Target} target
     */
    targetRemoved: function(target)
    {
        if (this._mainTarget === target) {
            delete this._mainTarget;
            target.consoleModel.removeEventListener(WebInspector.ConsoleModel.Events.ConsoleCleared, this._consoleCleared, this);
        }
    },

    /**
     * @return {!Array.<!WebInspector.ConsoleMessage>}
     */
    messages: function()
    {
        var targets = WebInspector.targetManager.targets();
        var result = [];
        for (var i = 0; i < targets.length; ++i)
            result = result.concat(targets[i].consoleModel.messages());
        return result;
    },

    _consoleCleared: function()
    {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.ConsoleCleared);
    },

    /**
     * @param {!WebInspector.Event} event
     */
    _consoleMessageAdded: function(event)
    {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.MessageAdded, event.data);
    },

    _consoleDiracMessage: function(event)
    {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.DiracMessage, event.data);
    },

    /**
     * @param {!WebInspector.Event} event
     */
    _consoleMessageUpdated: function(event)
    {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.MessageUpdated, event.data);
    },

    /**
     * @param {!WebInspector.Event} event
     */
    _commandEvaluated: function(event)
    {
        this.dispatchEventToListeners(WebInspector.ConsoleModel.Events.CommandEvaluated, event.data);
    },

    __proto__: WebInspector.Object.prototype
}

/**
 * @type {!WebInspector.MultitargetConsoleModel}
 */
WebInspector.multitargetConsoleModel;
