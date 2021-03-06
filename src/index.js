'use strict'

// const waterfall = require('async/waterfall')
// const reject = require('async/reject')
const each = require('async/each')
const series = require('async/series')
// const map = require('async/map')
// const once = require('once')

const WantManager = require('./want-manager')
const Network = require('./network')
// const DecisionEngine = require('./decision-engine')
const Notifications = require('./notifications')
const logger = require('./utils').logger
const Message = require('./types/message')

/**
 * JavaScript implementation of the Paratii Protocol 'data exchange' protocol
 * used by paratii.video on top of IPFS.
 *
 * @param {Libp2p} libp2p
 * @param {Blockstore} blockstore
 */
class Protocol {
  constructor (libp2p, blockstore, ethAddress) {
    this._libp2p = libp2p
    this._log = logger(this.peerInfo.id)

    // the network delivers messages
    this.network = new Network(libp2p, this)

    this.commandsList = {}
    this.ethAddress = ethAddress || 'address placeholder'
    // local database
    // this.blockstore = blockstore

    // this.engine = new DecisionEngine(this.peerInfo.id, blockstore, this.network)

    // handle message sending
    this.wm = new WantManager(this.peerInfo.id, this.network)

    this.blocksRecvd = 0
    this.dupBlocksRecvd = 0
    this.dupDataRecvd = 0

    this.notifications = new Notifications(this.peerInfo.id)
  }

  get peerInfo () {
    return this._libp2p.peerInfo
  }

  // handle messages received through the network
  _receiveMessage (peerId, incoming, callback) {
    this._log(`received MSG from ${peerId.toB58String()} ${incoming.hello.eth.toString()}`)
    this.notifications.receivedMsg(peerId, incoming)

    if (incoming.fragments.size === 0) {
      return callback()
    }

    const fragments = Array.from(incoming.fragments.values())
    each(fragments, (fragment, cb) => {
      // TODO  process commands here.
      switch (fragment.type) {
        case 1:
          // command
          this._log(`received Command : ${fragment.payload.toString()}`)
          this._processCommand(peerId, fragment)
          break
        case 2:
          // response
          this._log(`received response ${fragment.tid.toString()} : ${fragment.payload.toString()}`)
          this._processResponse(peerId, fragment)
          break
        default:
          callback(new Error('unknown fragment type'))
      }

      cb()
    }, callback)
  }

  _processCommand (peerId, command) {
    let msg = new Message({
      hello: {
        eth: this.ethAddress
      }
    })
    switch (command.payload.toString()) {
      case 'test':
        this._log('sending ok #', command.tid.toString())
        msg.addResponse('OK', command.tid.toString())
        break
      case 'transcode':
        // let args = JSON.parse(command.args)
        this._log('received TRANSCODE command, .. pulling file, args: ' + JSON.stringify(command))
        // console.log('received TRANSCODE command, .. pulling file, args: ' + JSON.stringify(command))
        msg.addResponse('OK', command.tid.toString())
        // TODO Trigger Transcoding process here.
        this.notifications.receivedTranscode(peerId, command)
        break
      default:
        this._log('received command, args: ' + JSON.stringify(command))
        this.notifications.receivedCommand(peerId, command)
        // throw new Error('unknown command')
    }

    this.wm._sendResponse(peerId, msg)

    // if (this.network && this.network._running) {
    //   this.network.sendMessage(peerId, msg, (err) => {
    //     if (err) throw err
    //     this._log('msg sent')
    //   })
    // } else {
    //   this._log('network is not running yet.')
    // }
  }

  _processResponse (peerId, response) {
    if (!this.commandsList[response.tid.toString()]) {
      this._log('TID NOT FOUND tid: ', response.tid.toString())
    } else {
      this._log('got response for ', response.tid.toString(), ': ', response.payload.toString())
    }
  }

  createCommand (cmd, args) {
    let tid = String(Math.random())
    let msg = new Message({
      hello: {
        eth: this.ethAddress
      }
    })
    this.commandsList[tid] = cmd
    if (args) {
      args = JSON.stringify(args)
      // console.log('adding args to command, ', args)
      msg.addCommand(cmd, tid, args)
    } else {
      msg.addCommand(cmd, tid)
    }
    this._log('command created: tid: ', tid, msg)
    return msg
  }

  // handle errors on the receiving channel
  _receiveError (err) {
    this._log.error('ReceiveError: %s', err.message)
  }

  // handle new peers
  _onPeerConnected (peerId) {
    this.wm.connected(peerId)
    this._log('_onPeerConnected ' + peerId.toB58String())
  }

  // handle peers being disconnected
  _onPeerDisconnected (peerId) {
    this.wm.disconnected(peerId)
    // this.engine.peerDisconnected(peerId)
    this._log('_onPeerDisconnected ', peerId)
  }

  /**
   * Return the current wantlist for a given `peerId`
   *
   * @param {PeerId} peerId
   * @returns {Wantlist}
   */
  wantlistForPeer (peerId) {
    // return this.engine.wantlistForPeer(peerId)
  }

  /**
   * Get the current list of wants.
   *
   * @returns {Array<WantlistEntry>}
   */
  getWantlist () {
    return this.wm.wantlist.entries()
  }

  /**
   * Get stats about the bitswap node.
   *
   * @returns {Object}
   */
  stat () {
    return {
      wantlist: this.getWantlist(),
      blocksReceived: this.blocksRecvd,
      dupBlksReceived: this.dupBlocksRecvd,
      dupDataReceived: this.dupDataRecvd,
      peers: this.engine.peers()
    }
  }

  /**
   * Start the bitswap node.
   *
   * @param {function(Error)} callback
   *
   * @returns {void}
   */
  start (callback) {
    series([
      (cb) => this.wm.start(cb),
      (cb) => this.network.start(cb)
    ], callback)
  }

  /**
   * Stop the bitswap node.
   *
   * @param {function(Error)} callback
   *
   * @returns {void}
   */
  stop (callback) {
    series([
      (cb) => this.wm.stop(cb),
      (cb) => this.network.stop(cb)
    ], callback)
  }
}

module.exports = Protocol
