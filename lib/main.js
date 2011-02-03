// Simple JavaScript deminifier

let { Cc, Ci, Cu } = require('chrome');
let data = require('self').data;
let parse_js = require('parse-js');
let process = require('process');

let imports = {};

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

Cu.import("resource://gre/modules/Services.jsm", imports);
Cu.import("resource://gre/modules/XPCOMUtils.jsm", imports);

function Traverser(firstNode) {
    this._node = firstNode;
}

Traverser.prototype = {
    next: function() {
        if (!this._node)
            return null;

        let node = this._node.nextSibling;
        if (!node)
            node = this._node.parentNode.nextSibling.firstChild;

        this._node = node;
        return node;
    }
};

function WindowController(window) {
    this._animateIn = this._animateIn.bind(this);
    this._animateInFinished = this._animateInFinished.bind(this);
    this._animateOut = this._animateOut.bind(this);
    this._animateOutFinished = this._animateOutFinished.bind(this);
    this._attachToDocument = this._attachToDocument.bind(this);
    this._contentDocumentLoaded = this._contentDocumentLoaded.bind(this);
    this._onBackButtonClicked = this._onBackButtonClicked.bind(this);
    this._overlayLoaded = this._overlayLoaded.bind(this);

    this._window = window;
    this._document = this._window.document;
    this._contentBrowser = window.document.getElementById('content');

    // Wrap the browser inside a stack.
    let appContent = this._document.getElementById('appcontent');
    appContent.removeChild(this._contentBrowser);
    this._stack = this._document.createElementNS(XUL_NS, 'stack');
    this._stack.appendChild(this._contentBrowser);
    this._stack.setAttribute('flex', 1);
    appContent.appendChild(this._stack);

    this._contentBrowser.addProgressListener(this,
        Ci.nsIWebProgress.NOTIFY_ALL);

    this._attachToDocument();
}

WindowController.prototype = {
    _animateIn: function(ev) {
        this._panel.addEventListener('transitionend',
            this._animateInFinished, false);
        this._panel.style.MozTransform = "translateX(0)";
        this._backdrop.style.opacity = "0.8";
    },

    _animateInFinished: function(ev) {
        this._panel.removeEventListener("transitionend",
            this._animateInFinished, false);
        this._panel.style.overflow = 'auto';

        this._sourceElement.innerHTML = this._source;
    },

    _animateOut: function(ev) {
        this._panel.addEventListener("transitionend",
            this._animateOutFinished, false);
        this._panel.style.MozTransform = "translateX(100%)";
        this._backdrop.style.opacity = 0;
        this._sourceElement.removeChild(this._sourceElement.firstChild);
    },

    _animateOutFinished: function(ev) {
        this._panel.removeEventListener("transitionend",
            this._animateOutFinished, false);
        this._stack.removeChild(this._overlay);

        this._overlay = this._panel = null;
    },

    _attachToDocument: function() {
        this._contentDocument = this._contentBrowser.contentDocument;
        this._body = this._contentDocument.body;
        this._originalText = this._body.textContent;

        this._styleDocument();

        if (this._contentDocument.getElementsByClassName('start-tag').length)
            this._markUpHTML();
        else
            this._markUpJS();
    },

    _contentDocumentLoaded: function() {
        this._contentBrowser.contentWindow.removeEventListener('load',
            this._contentDocumentLoaded, false);
        this._attachToDocument();
    },

    _createDeminifyButton: function(data) {
        let button = this._contentDocument.createElement("button");
        button.classList.add('deminify-button');
        if (!data)
            button.classList.add('deminify-all');

        button.appendChild(this._contentDocument.createTextNode("Deminify"));
        let callback = this._onDeminifyClicked.bind(this, data);
        button.addEventListener("click", callback, false);
        return button;
    },

    _getScriptDataForNode: function(node) {
        if (!node)
            return this._originalText;

        let scriptData = [];
        let traverser = new Traverser(node);
        while ((node = traverser.next())) {
            if (node.nodeType === 1 && node.classList.contains('end-tag'))
                break;
            scriptData.push(node.textContent);
        }

        let scriptDataString = scriptData.join("");
        let start = scriptDataString.indexOf(">") + 1;
        let end = scriptDataString.lastIndexOf("<");
        scriptDataString = scriptDataString.substring(start, end);
        scriptDataString = scriptDataString.replace(/^\s*<!--/, "");
        return scriptDataString;
    },

    _markUpHTML: function() {
        let startTags = this._contentDocument.
            getElementsByClassName('start-tag');
        for (let i = 0; i < startTags.length; i++) {
            let tag = startTags[i];
            if (tag.textContent.toLowerCase() != 'script')
                continue;

            let shouldAddButton = true;
            let traverser = new Traverser(tag);
            let node;
            let j = 0;
            while ((node = traverser.next())) {
                if (node.nodeType != 1) // element
                    continue;
                if (node.classList.contains('start-tag'))
                    break;
                if (node.classList.contains('attribute-name') &&
                        /^\s*src\s*$/i.test(node.textContent)) {
                    // Don't add the deminify button to external scripts.
                    shouldAddButton = false;
                    break;
                }
            }

            if (shouldAddButton)
                tag.appendChild(this._createDeminifyButton(tag));
        }
    },

    _markUpJS: function() {
        let button = this._createDeminifyButton(null);
        this._body.insertBefore(button, this._body.firstChild);
    },

    _onBackButtonClicked: function(ev) {
        this._prepareAnimateOut();
    },

    _onDeminifyClicked: function(node, ev) {
        try {
            let ast = parse_js.parse(this._getScriptDataForNode(node));
            this._source = process.gen_code(ast, true);

            this._overlay = this._window.document.createElementNS(XUL_NS,
                "iframe");
            this._overlay.setAttribute('src', data.url('display.html'));

            this._stack.appendChild(this._overlay);

            this._overlay.contentWindow.addEventListener('load',
                this._overlayLoaded, false);
        } catch (ex) {
            let promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Ci.nsIPromptService);
            promptService.alert(this._contentDocument.defaultView,
                "Deminification failed", "" + ex);
        }
    },

    _overlayLoaded: function(ev) {
        this._overlay.contentWindow.removeEventListener('load',
            this._overlayLoaded, false);

        let displayDocument = this._overlay.contentWindow.document;

        let back = displayDocument.getElementById('back');
        this._panel = displayDocument.getElementById('panel');
        this._backdrop = displayDocument.getElementById('backdrop');
        this._sourceElement = displayDocument.getElementById('source');

        back.addEventListener('click', this._onBackButtonClicked, false);
        this._backdrop.addEventListener('click', this._onBackButtonClicked,
            false);

        this._animateIn();
    },

    _prepareAnimateOut: function() {
        this._sourceElement.innerHTML = "";
        this._window.setTimeout(this._animateOut, 0);
    },

    // Adds our style sheet to the document.
    _styleDocument: function() {
        let head = this._contentDocument.getElementsByTagName('head')[0];
        let styleElement = this._contentDocument.createElement('style');
        let styleText = data.load('view-source-additions.css');
        let styleTextNode = this._contentDocument.createTextNode(styleText);
        styleElement.appendChild(styleTextNode);
        head.appendChild(styleElement);
    },

    onLocationChange: function(progress, request, location) {
        this._contentBrowser.contentWindow.addEventListener('load',
            this._contentDocumentLoaded, false);
    },

    onProgressChange: function() {},
    onSecurityChange: function() {},
    onStateChange: function() {},
    onStatusChange: function() {},
    onProgressChange64: function() {},
    onRefreshAttempted: function() {},

    QueryInterface:
        imports.XPCOMUtils.generateQI([ Ci.nsIWebProgressListener,
                                        Ci.nsIWebProgressListener2,
                                        Ci.nsISupportsWeakReference ])
};

let windowObserver = {
    observe: function(subject, topic, data) {
        if (topic !== 'domwindowopened')
            return;

        let window = subject.QueryInterface(Ci.nsIDOMWindow);
        window.addEventListener('load', this.onWindowLoad, false);
    },

    onWindowLoad: function(ev) {
        let document = ev.target, window = ev.target.defaultView;
        window.removeEventListener('load', this.onWindowLoad, false);

        if (document.documentElement.id !== 'viewSource')
            return;

        new WindowController(window);
    }
};

function main() {
    imports.Services.ww.registerNotification(windowObserver);
}

main();

