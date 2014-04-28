/**
 * MediaFire JavaScript SDK
 * Licensed under the Apache License, Version 2.0
 */

(function() {
    "use strict";

    /**
     * Initializes an application specific instance of MediaFire
     * @param {number} appId The supplied MediaFire application id
     * @param {string} appKey The supplied MediaFire application key
     * @constructor
     */
    function MediaFire(appId, appKey, options) {
        /**
         * Path to the uploader resources
         * @constant
         * @type {string}
         * @private
         */
        this._UPLOADER_RESOURCE_PATH = options.resourcePath || '';

        /**
         * Path to the MediaFire api
         * @constant
         * @type {string}
         * @private
         */
        this._API_PATH = '//mediafire.com/api/';

        /**
         * Application ID
         * @type {number}
         * @private
         */
        this._appId = appId;

        /**
         * Application Key
         * @type {string}
         * @private
         */
        this._appKey = appKey;

        /**
         * API Session Token
         * @type {string}
         * @private
         */
        this._sessionToken = '';

        /**
         * Uploader instance
         * @type {MFUploader}
         * @private
         */
        this._uploader;

        /**
         * Action token for the uploader
         * @type {string}
         * @private
         */
        this._actionToken;

        /**
         * Asynchronously loads the necessary resources before performing an upload
         * @param {(object|function)=} callback The success and/or error callback functions
         * @private
         */
        this._loadUploader = function(callback) {
            callback = this._parseCallback(callback);
            var self = this;

            // The uploader calls this global function when it is ready
            window.mfUploaderReady = function() {
                callback.success();
            };

            var id = 'mf-uploader';
            // Script has already been injected, nothing to do here
            if(document.getElementById(id)) {
                return;
            }

            // Inject the uploader script
            var target = document.getElementsByTagName('script')[0];
            var script = document.createElement('script');
            script.id = id;
            script.async = true;
            script.src = this._UPLOADER_RESOURCE_PATH + 'mfuploader.js';
            target.parentNode.insertBefore(script, target);
        };

        /**
         * Conforms callback input into a standard for internal use
         * @param {(object|function)=} callback The success and/or error callback functions
         * @returns {object} Conformed callback
         * @private
         */
        this._parseCallback = function(callback) {
            if(typeof callback === 'function') {
                callback = { success: callback };
            }
            return callback || {};
        };

        /**
         * Extend or update the current session token
         * @private
         */
        this._renew = function() {
            /** @this MediaFire */
            var updateToken = function(data) {
                this._sessionToken = data.response.session_token;
            };

            this._get(this._API_PATH + 'user/renew_session_token.php', null, updateToken, this);
        };

        /**
         * Core XHR functionality
         * @param {string} url An absolute or relative url for the XHR
         * @param {object=} params Parameters to include with the request
         * @param {object=} callback The success and/or error callback functions
         * @param {*=} scope A scope to call the callback functions with
         * @private
         */
        this._get = function(url, params, callback, scope) {
            // Create XHR
            var xhr = new XMLHttpRequest();

            // Make sure params exists
            if(!params) {
                params = {};
            }

            // Handle callbacks
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    // Return raw response if we cannot parse JSON.
                    var response = (typeof JSON === 'undefined') ? xhr.responseText : JSON.parse(xhr.responseText);
                    if (xhr.status === 200) {
                        // Success
                        if(callback.success) {
                            callback.success.call(scope, response, xhr);
                        }
                    } else {
                        // Error
                        if(callback.error) {
                            callback.error.call(scope, response, xhr);
                        }
                    }
                }
            };

            // Augment parameters
            if(this._sessionToken) {
                params.session_token = this._sessionToken;
            }
            params.response_format = 'json';

            // Construct parameters
            url += '?' + Object.keys(params).map(function(key) {
                return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
            }).join('&');

            // Send request
            xhr.open('GET', url, true);
            xhr.send(null);
        };

        /**
         * Generates an upload action token
         * @param {(object|function)=} callback The success and/or error callback functions
         * @private
         */
        this._getUploadActionToken = function(callback) {
            var options = {type: 'upload', lifespan: 1440};
            this._get(this._API_PATH + 'user/get_action_token.php', options, this._parseCallback(callback), this);
        };
    }

    /**
     * Creates a new session
     * @param {object} credentials
     * @param {(object|function)=} callback The success and/or error callback functions
     * @returns {MediaFire} For chaining methods
     */
    MediaFire.prototype.login = function(credentials, callback) {
        // Auth-like login available, and credentials is a callback or null
        if(this._authLogin && (!credentials || typeof credentials === 'function')) {
            this._authLogin(credentials);
        }

        var oThis = this;
        callback = this._parseCallback(callback);

        /** @this MediaFire */
        var saveToken = function(data) {
            oThis._sessionToken = data.response.session_token;
        };

        // Inject internal success callback
        if(callback.success) {
            var originalCallback = callback.success;
            callback.success = function(data) {
                saveToken(data);
                originalCallback(data);
            };
        } else {
            callback.success = saveToken;
        }

        // Determine what credentials are needed to for the signature.
        var partial;
        if(credentials.email && credentials.password) {
            partial = credentials.email + credentials.password;
        } else if(credentials.tw_oauth_token && credentials.tw_oauth_token_secret) {
            partial = credentials.tw_oauth_token + credentials.tw_oauth_token_secret;
        } else if (credentials.fb_access_token) {
            partial = credentials.fb_access_token;
        }

        // Augment credentials
        credentials.application_id = this._appId;
        credentials.signature = new SHA1().digestFromString(partial + this._appId + this._appKey);

        // Send session token request
        this._get('https:' + this._API_PATH + 'user/get_session_token.php', credentials, callback, this);

        // Renew session token every 6 minutes.
        var self = this;
        setInterval(function() {
            self._renew.call(self);
        }, 6 * 60 * 1000);

        return this;
    };

    /**
     * Sends an api request
     * @param {string} path The relevant api path
     * @param {object=} options Parameters to include with the request
     * @param {(object|function)=} callback The success and/or error callback functions
     * @returns {MediaFire} For chaining methods
     */
    MediaFire.prototype.api = function(path, options, callback) {
        this._get(this._API_PATH + path + '.php', options, this._parseCallback(callback), this);
        return this;
    };

    /**
     * Uploads files into the logged-in user's account
     * @param {object} files a FileList object from an event
     * @param {object=} callback {onUpdate:, onUploadProgress:, onHashProgress:}
     * @returns {MediaFire} For chaining methods
     */
    MediaFire.prototype.upload = function(files, callbacks) {
        var actionToken = this._actionToken;
        var self = this;
        var bFilesSent = false;

        var checkReadyState = function() {
            if(actionToken) {
                if(window.MFUploader && !self._uploader) {
                    var options = {
                        apiUrl: self._API_PATH,
                        resourcePath: self._UPLOADER_RESOURCE_PATH
                    };
                    self._uploader = new MFUploader(actionToken, callbacks, options);
                }

                if(self._uploader) {
                    bFilesSent = true;
                    self._uploader.send(files);
                }
            }
        };

        // Generate action token
        if(actionToken) {
            checkReadyState();
        } else {
            this._getUploadActionToken(function(data) {
                actionToken = data.response.action_token;
                this._actionToken = actionToken;
                checkReadyState();
            });
        }

        // Load uploader resources
        if(!bFilesSent) {
            if(window.MFUploader || this._uploader) {
                checkReadyState();
            } else {
                this._loadUploader(function(MFUploader) {
                    checkReadyState();
                });
            }
        }

        return this;
    };    

    window.MF = MediaFire;
})();

/**
 * Copyright (c) 2013 Sam Rijs (http://awesam.de)
 * Licensed under the MIT License (MIT)
 */
(function(){
    if(typeof FileReaderSync!=='undefined'){var reader=new FileReaderSync(),hasher=new Rusha(4*1024*1024);self.onmessage=function onMessage(event){var hash,data=event.data.data;if(data instanceof Blob){try{data=reader.readAsBinaryString(data);}catch(e){self.postMessage({id:event.data.id,error:e.name});return;}}
        hash=hasher.digest(data);self.postMessage({id:event.data.id,hash:hash});};}
    function Rusha(sizeHint){"use strict";var self={fill:0};var padlen=function(len){return len+1+((len)%64<56?56:56+64)-(len)%64+8;};var padZeroes=function(bin,len){for(var i=len>>2;i<bin.length;i++)bin[i]=0;};var padData=function(bin,len){bin[len>>2]|=0x80<<(24-(len%4<<3));bin[(((len>>2)+2)&~0x0f)+15]=len<<3;};var convStr=function(str,bin,len){var i;for(i=0;i<len;i=i+4|0){bin[i>>2]=str.charCodeAt(i)<<24|str.charCodeAt(i+1)<<16|str.charCodeAt(i+2)<<8|str.charCodeAt(i+3);}};var convBuf=function(buf,bin,len){var i,m=len%4,j=len-m;for(i=0;i<j;i=i+4|0){bin[i>>2]=buf[i]<<24|buf[i+1]<<16|buf[i+2]<<8|buf[i+3];}
        switch(m){case 0:bin[j>>2]|=buf[j+3];case 3:bin[j>>2]|=buf[j+2]<<8;case 2:bin[j>>2]|=buf[j+1]<<16;case 1:bin[j>>2]|=buf[j]<<24;}};var conv=function(data,bin,len){if(typeof data==='string'){return convStr(data,bin,len);}else if(data instanceof Array||(typeof global!=='undefined'&&typeof global.Buffer!=='undefined'&&data instanceof global.Buffer)){return convBuf(data,bin,len);}else if(data instanceof ArrayBuffer){return convBuf(new Uint8Array(data),bin,len);}else if(data.buffer instanceof ArrayBuffer){return convBuf(new Uint8Array(data.buffer),bin,len);}else{throw new Error('Unsupported data type.');}};var hex=function(binarray){var i,x,hex_tab="0123456789abcdef",res=[];for(i=0;i<binarray.length;i++){x=binarray[i];res[i]=hex_tab.charAt((x>>28)&0xF)+
        hex_tab.charAt((x>>24)&0xF)+hex_tab.charAt((x>>20)&0xF)+hex_tab.charAt((x>>16)&0xF)+hex_tab.charAt((x>>12)&0xF)+hex_tab.charAt((x>>8)&0xF)+hex_tab.charAt((x>>4)&0xF)+hex_tab.charAt((x>>0)&0xF);}
        return res.join('');};var nextPow2=function(v){var p=1;while(p<v)p=p<<1;return p;};var resize=function(size){self.sizeHint=size;self.heap=new ArrayBuffer(nextPow2(padlen(size)+320));self.core=RushaCore({Int32Array:Int32Array},{},self.heap);};resize(sizeHint||0);var coreCall=function(len){var h=new Int32Array(self.heap,len<<2,5);h[0]=1732584193;h[1]=-271733879;h[2]=-1732584194;h[3]=271733878;h[4]=-1009589776;self.core.hash(len);};var rawDigest=this.rawDigest=function(str){var len=str.byteLength||str.length;if(len>self.sizeHint){resize(len);}
        var view=new Int32Array(self.heap,0,padlen(len)>>2);padZeroes(view,len);conv(str,view,len);padData(view,len);coreCall(view.length);return new Int32Array(self.heap,0,5);};this.digest=this.digestFromString=this.digestFromBuffer=this.digestFromArrayBuffer=function(str){return hex(rawDigest(str));};};function RushaCore(stdlib,foreign,heap){"use asm";var H=new stdlib.Int32Array(heap);function hash(k){k=k|0;var i=0,j=0,y0=0,z0=0,y1=0,z1=0,y2=0,z2=0,y3=0,z3=0,y4=0,z4=0,t0=0,t1=0;y0=H[k+0<<2>>2]|0;y1=H[k+1<<2>>2]|0;y2=H[k+2<<2>>2]|0;y3=H[k+3<<2>>2]|0;y4=H[k+4<<2>>2]|0;for(i=0;(i|0)<(k|0);i=i+16|0){z0=y0;z1=y1;z2=y2;z3=y3;z4=y4;for(j=0;(j|0)<16;j=j+1|0){t1=H[i+j<<2>>2]|0;t0=((((y0)<<5|(y0)>>>27)+(y1&y2|~y1&y3)|0)+((t1+y4|0)+1518500249|0)|0);y4=y3;y3=y2;y2=((y1)<<30|(y1)>>>2);y1=y0;y0=t0;H[k+j<<2>>2]=t1;}
        for(j=k+16|0;(j|0)<(k+20|0);j=j+1|0){t1=(((H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])<<1|(H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])>>>31));t0=((((y0)<<5|(y0)>>>27)+(y1&y2|~y1&y3)|0)+((t1+y4|0)+1518500249|0)|0);y4=y3;y3=y2;y2=((y1)<<30|(y1)>>>2);y1=y0;y0=t0;H[j<<2>>2]=t1;}
        for(j=k+20|0;(j|0)<(k+40|0);j=j+1|0){t1=(((H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])<<1|(H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])>>>31));t0=((((y0)<<5|(y0)>>>27)+(y1^y2^y3)|0)+((t1+y4|0)+1859775393|0)|0);y4=y3;y3=y2;y2=((y1)<<30|(y1)>>>2);y1=y0;y0=t0;H[j<<2>>2]=t1;}
        for(j=k+40|0;(j|0)<(k+60|0);j=j+1|0){t1=(((H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])<<1|(H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])>>>31));t0=((((y0)<<5|(y0)>>>27)+(y1&y2|y1&y3|y2&y3)|0)+((t1+y4|0)-1894007588|0)|0);y4=y3;y3=y2;y2=((y1)<<30|(y1)>>>2);y1=y0;y0=t0;H[j<<2>>2]=t1;}
        for(j=k+60|0;(j|0)<(k+80|0);j=j+1|0){t1=(((H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])<<1|(H[j-3<<2>>2]^H[j-8<<2>>2]^H[j-14<<2>>2]^H[j-16<<2>>2])>>>31));t0=((((y0)<<5|(y0)>>>27)+(y1^y2^y3)|0)+((t1+y4|0)-899497514|0)|0);y4=y3;y3=y2;y2=((y1)<<30|(y1)>>>2);y1=y0;y0=t0;H[j<<2>>2]=t1;}
        y0=y0+z0|0;y1=y1+z1|0;y2=y2+z2|0;y3=y3+z3|0;y4=y4+z4|0;}H[0]=y0;H[1]=y1;H[2]=y2;H[3]=y3;H[4]=y4;}return{hash:hash};}
    window.SHA1=Rusha;
})();