/*
 * Copyright (c) 2012 Adam Jabłooński
 *
 * Gmail Notify Extension is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gmail Notify Extension is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Authors: Adam Jabłoński <jablona123@gmail.com>
 *          Vadim Rutkovsky <roignac@gmail.com>
 *
 */
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Logger = Extension.imports.logger;
const Unicode = Extension.imports.unicode;
const BigInteger = Extension.imports.biginteger;

const Signals = imports.signals;
const Lang = imports.lang;

function ImapMessage () {
    this._init();
};
ImapMessage.prototype = {
    _init : function () {
        this.from="";
        this.subject="";
        this.date="";
        this.id =0;
        this.link="";
        this.safeid="";
    },
    set : function (prop,value){
        switch (prop.toLowerCase())
        {
        case "from":
            this.from=value;
            break;
        case "link":
            this.link=value;
            break;
        case "id":
            this.id=value;
            break;
        case "subject":
            this.subject=value;
            break;
        case "safeid":
            this.safeid=value;
            break;
        case "date":
            this.date=value;
            break;
        }
    }
};
var Imap = function () {
    this._init.apply(this,arguments);
};
Imap.prototype = {
    _init : function (conn) {
        this._conn = conn;
        this.authenticated = false;
        this.folders = new Array();
    },
    _gen_tag:  function () {
        let tag = "";
        for (let i = 0; i < 5; i++)
            tag += Math.floor(Math.random()*10).toString();
        return tag;
    },
    _commandOK : function(aResp) {
        try {
            let ret=false ;
            if (aResp !=null) {
                for (let response in aResp) {
                    if (response.search(/^[0-9]{5} OK.*$/)>-1)
                    {
                        ret = true;
                        break;
                    }

                }
                return ret;
            }
            else {
                 return false ;
            }
        } catch (err) {
            Logger.log('_CommmandOK error:'+err.message);
        }
        return true;
    },
    _readBuffer : function (tag,is_init,decode,callback,read,i) {
            is_init = typeof (is_init) != 'undefined' ? is_init : false;
            decode = typeof (decode) != 'undefined' ? decode : true;
            if (typeof(read) =='undefined') {
                i=0;
                Logger.log ("initializing array .. "+i)
                read= new Array();
            } else {
                i++
            }
            this._conn.inputStream.read_line_async(0,null,Lang.bind(this,function (stream,result) {
                    let buff=this._conn.inputStream.read_line_finish(result);
                    if (buff==null) Logger.log("Buffer null!");
                    read[i] = (new String(buff[0])).substr(0,buff[0].length-1);
                    if (decode){
                        let matches=read[i].match(/&.*-/g);
                        if (matches != null){
                            for (let match in matches) {
                                    let dec=GLib.base64_decode(match.substr(1,match.length-2)+"="+(match.length % 2 ==0 ? "=":""));
                                    let us="";
                                    for(let k=0;k<dec.length;k+=2){
                                        us+=String.fromCharCode(dec[k]*256+dec[k+1]);
                                    }
                                    read[i]=read[i].replace(matches[j],us);
                            }
                        }
                    }
                    if ((tag.length >0 && read[i].substr(0,tag.length)  == tag) || (is_init)) {

                        if (typeof(callback) != 'undefined') {
                            callback.apply(this,[this,read]);
                        }
                        this.emit('buffer-ready',read);

                    } else {
                        this._readBuffer(tag,is_init,decode,callback,read,i);
                    }

            }),
            null);
        },
    _logout : function() {
        if (this.connected) {
            let tag=this._gen_tag();
            this._output_stream.put_string(tag+" LOGOUT"+_newline,null);
            this._readBuffer(tag,false,true,Lang.bind(this,function(oImap,resp){
                for (let response in resp) Logger.log(response);
                this.emit('logged out',resp);
            }));
        }
    },

    _command : function (cmd,decode,callback) {
        decode = typeof (decode) != 'udefined' ? decode : true;
            Logger.log ("Entering Command ..");
            let tag=this._gen_tag();
            Logger.log ("Sending .. "+ tag+" "+cmd);
            if (this._conn.outputStream.put_string(tag+" "+cmd+this._conn.newline,null))
            {
                this._readBuffer(tag,false,decode,Lang.bind(this,function(oImap,resp){
                    Logger.log("Entering callback .. ");
                    //for (let i=0;i<resp.length;i++) Logger.log("< "+resp[i]);
                    if (typeof(callback)!='undefined') {
                        Logger.log ("Calling callback .. ");
                        callback.apply(this,[this,resp]);
                    }
                }));
            }
            else
            {
                throw new Error ('Imap command: cannot put command');
            }
    },
    _scanFolder: function (folder,callback) {
        try
        {
        this.folders=new Array();
        this._command("EXAMINE "+folder,true,Lang.bind(this,function(oImap,resp) {
            {for (let i=0;i<resp.length;i++) Logger.log("< "+resp[i]);}
            //get number of total and unseen
            let sTotal=0;
            let sUnseen=0;
            for (let response in resp) {
                let tmatch=response.match (/\* ([0-9]+) EXISTS.*/);
                if (tmatch!=null) {
                     Logger.log ("-- TOTAL "+tmatch[1]);
                     sTotal=parseInt(tmatch[1]);
                }

            }
            try {
            let messages=new Array();
            this._command("SEARCH UNSEEN",true,Lang.bind(this,function(oImap,resp) {

                    let xmatches=resp[0].match(/(([0-9]+[ ]*)+){1}/g);
                    if (xmatches!=null)
                    {
                        Logger.log("xmatches"+xmatches);
                        sUnseen=xmatches[0].split(" ").length;
                        for (let xmatch in xmatches) { Logger.log (xmatch) }
                        Logger.log("FETCH");
                        this._command("FETCH "+xmatches[0].replace(/ /g,",")+" (FLAGS BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)] X-GM-MSGID)",false, Lang.bind(this,function(oImap,presp)
                            {  try {
                                       /*for (let d=0;d<presp.length;d++)
                                        {
                                            Logger.log ("Line "+d.toString()+": "+presp[d]);
                                            Logger.log ("char "+d.toString()+": "+presp[d].charCodeAt(0));
                                        }*/
                                var fline="";
                                var part="";
                                var m;
                                for (let l=0;l<presp.length;l++)
                                {
                                    Logger.log (Unicode.unescapeFromMime(presp[l]));
                                    let line = Unicode.unescapeFromMime(presp[l]);
                                    let pmatches=line.match(/^(From|Date|Subject){1}\s*[:]{1}(.*)$/i);
                                    if (pmatches != null)
                                    {
                                        Logger.log("Match! fline:"+fline);
                                        if (fline!="")
                                        {
                                            m.set(part,fline);
                                            //messages.push(m);
                                            Logger.log("Push!");
                                        }
                                        part=pmatches[1];
                                        fline=pmatches[2];
                                    }
                                    else
                                    {
                                            //Logger.log("No match!, line:" +line);
                                            //Logger.log("No match!, code:" +line.substr(0,1).charCodeAt(0));
                                        if ( presp[l].substr(0,1)==" ")
                                        {
                                            Logger.log("Space !");
                                            fline+=line;
                                            continue;
                                        }
                                        if ( presp[l].substr(0,1)=="*")
                                        {
                                            Logger.log("Star!");
                                            if (fline!="")
                                            {
                                                m.set(part,fline);
                                                messages.push(m);
                                            }
                                            m=new ImapMessage();
                                            let idmatches=line.match(/^\*\s([0-9]+)\sFETCH\s+\(X-GM-MSGID\s([0-9]+)\s.+/);
                                            if (idmatches !=null)
                                            {
                                                try {
                                                    m.set("id",parseInt(idmatches[1]));
                                                    let ba=BigInteger.BigInteger.parse(idmatches[2]);
                                                    Logger.log(ba.toString(16));
                                                    m.set("link",'https://mail.google.com/mail/u/0/#inbox/'+ba.toString(16).toLowerCase());
                                                }
                                                catch (err) {
                                                    Logger.log(err.message);
                                                }
                                            }
                                            
                                            fline="";
                                            continue;
                                        }
                                        if (fline!="")
                                        {
                                            m.set(part,fline);
                                            messages.push(m);
                                            fline=""
                                        }
                                    }
                                }
                                this.folders.push(new Object({name:folder,encoded:folder,messages:sTotal,unseen:sUnseen,list: messages }));
                                if (typeof (callback)!='undefined')
                                {
                                    callback.apply(this,[this,messages])
                                }
                                this.emit('folder-scanned',folder);
                            }
                            catch (err) {
                                if (typeof (callback)!='undefined')
                                {
                                    callback.apply(this,[this,null,err])
                                }

                            }
                        }));    //FETCH
                    }
                    else {
                            this.folders.push(new Object({name:folder,encoded:folder,messages:sTotal,unseen:sUnseen,list:messages }));
                            if (typeof (callback)!='undefined')
                            {
                                    callback.apply(this,[this,messages])
                            }
                            this.emit('folder-scanned',folder);
                    }

                }));
            }
            catch (err) {
                if (typeof (callback)!='undefined')
                {
                    callback.apply(this,[this,null,err])
                }
            }
            }));
    }
    catch (err)
    {
        if (typeof (callback)!='undefined')
        {
            callback.apply(this,[this,null,err])
        }
    }
    },
    _scan : function (inboxOnly,callback) {
        inboxOnly=typeof (inboxOnly) !='undefined' ? inboxOnly:true;
        Logger.log ("scan entry ..");
        if (this.authenticated)
        {
            Logger.log ("weel authenticated ..");
            try
            {
                    this._command("EXAMINE INBOX",true,Lang.bind(this,function(oImap,resp){
                    {for (let i=0;i<resp.length;i++) Logger.log("< "+resp[i]);}
                    this._command("LIST \"\" *",false,Lang.bind(this,function(oImap,resp){
                        {for (let i=0;i<resp.length;i++) Logger.log(resp[i]);}
                        let sumMess=0;
                        let sumUnseen=0;
                            // for every folder
                        for (let i=0;i<resp.length;i++){
                            let matches=inboxOnly ? resp[i].match(/("INBOX")$/g) :resp[i].match(/("[^".]*")$/g);
                            if (matches !=null)
                            {
                                this._command("STATUS "+matches[0]+" (MESSAGES UNSEEN)",true,Lang.bind(this,function(oImap,cmdstatus){
                                    if (this._commandOK(cmdstatus))
                                    {
                                        for (let k=0;k<cmdstatus.length-1;k++)
                                        {
                                            let cmdmatches=cmdstatus[k].match(/^\* STATUS "(.*)" \(MESSAGES ([0-9]*) UNSEEN ([0-9]*)\)$/);
                                            if (cmdmatches !=null)
                                            {
                                                if (cmdmatches[1].toUpperCase().search(/^\[GMAIL|IMAP\]/)==-1)
                                                {
                                                    sumMess+=parseInt(cmdmatches[2]);
                                                    sumUnseen+=parseInt(cmdmatches[3]);
                                                    let messages=new Array();
                                                    Logger.log("SEARCH");
                                                        //SEARCH UNSEEN
                                                }
                                            }
                                        }
                                    }
                                    }));    //STATUS MESSAGES UNSEEN
                                //
                                if (inboxOnly) break;
                            }
                        }
                        //
                        Logger.log("MESS in SCAN "+sumMess.toString());
                        this.numMessages=sumMess;
                        this.numUnseen=sumUnseen;
                })); //LIST
            })); //EXAMINE INBOX

    }
    catch (err){
        return [false,err.message];
    }
    if (typeof(callback) != 'undefined')
    {
        callback.apply(this,[this]);
    }
    }
    return [false,"Not authenticaed or connected"];
    },

};
Signals.addSignalMethods(Imap.prototype);
