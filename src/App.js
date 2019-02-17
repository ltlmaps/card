import React, { Component } from "react";
import { getConnextClient } from "connext/dist/Connext.js";
import "./App.css";
import ProviderOptions from "./utils/ProviderOptions.ts";
import clientProvider from "./utils/web3/clientProvider.ts";
import { setWallet } from "./utils/actions.js";
import {
  createWallet,
  createWalletFromKey,
  findOrCreateWallet,
  createWalletFromMnemonic
} from "./walletGen";
import { createStore } from "redux";
import axios from "axios";
import ReceiveCard from "./components/receiveCard";
import SendCard from "./components/sendCard";
import CashOutCard from "./components/cashOutCard";
import ChannelCard from "./components/channelCard";
import Tooltip from "@material-ui/core/Tooltip";
import AppBar from "@material-ui/core/AppBar";
import QRIcon from "mdi-material-ui/Qrcode"
import Toolbar from "@material-ui/core/Toolbar";
import SettingIcon from "@material-ui/icons/Settings"
import SendIcon from "@material-ui/icons/Send"
import ReceiveIcon from "@material-ui/icons/SaveAlt"
import IconButton from "@material-ui/core/IconButton";
import Modal from "@material-ui/core/Modal";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Popover from "@material-ui/core/Popover";
import { CopyToClipboard } from "react-copy-to-clipboard";
import Connext from "./assets/Connext.svg";
import { Typography, Fab, Card } from "@material-ui/core";
import blockies from "ethereum-blockies-png"
const Web3 = require("web3");
const Tx = require("ethereumjs-tx");
const eth = require("ethers");
const humanTokenAbi = require("./abi/humanToken.json");
const wethAbi = require("./abi/weth.json");
const noAddrBlocky = require("./assets/noAddress.png")
require("dotenv").config();

let tokenAbi
if (process.env.NODE_ENV === "production"){
  tokenAbi = wethAbi
} else {
  tokenAbi = humanTokenAbi
}


console.log(`starting app in env: ${JSON.stringify(process.env, null, 1)}`);
const hubUrl = process.env.REACT_APP_HUB_URL.toLowerCase();
//const providerUrl = process.env.REACT_APP_ETHPROVIDER_URL.toLowerCase()
const tokenAddress = process.env.REACT_APP_TOKEN_ADDRESS.toLowerCase();
const hubWalletAddress = process.env.REACT_APP_HUB_WALLET_ADDRESS.toLowerCase();
const channelManagerAddress = process.env.REACT_APP_CHANNEL_MANAGER_ADDRESS.toLowerCase();

console.log(`Using token ${tokenAddress} with abi: ${tokenAbi}`)

const HASH_PREAMBLE = "SpankWallet authentication message:";
const DEPOSIT_MINIMUM_WEI = eth.utils.parseEther("0.04"); // 40FIN

const opts = {
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: "Bearer foo"
  },
  withCredentials: true
};

export const store = createStore(setWallet, null);

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      web3: null,
      customWeb3: null,
      tokenContract: null,
      connext: null,
      delegateSigner: null,
      modals: {
        keyGen: false,
        receive: false,
        send: false,
        cashOut: false,
      },
      metamask: {
        address: null,
        balance: 0,
        tokenBalance: 0
      },
      hubWallet: {
        address: hubWalletAddress,
        balance: 0,
        tokenBalance: 0
      },
      channelManager: {
        address: channelManagerAddress,
        balance: 0,
        tokenBalance: 0
      },
      authorized: "false",
      approvalWeiUser: "10000",
      recipient: hubWalletAddress,
      channelState: null,
      exchangeRate: "0.00",
      anchorEl: null,
      interval: null
    };
  }


  // ************************************************* //
  //                     Hooks                         //
  // ************************************************* //   

  async componentWillMount() {
    const mnemonic = localStorage.getItem("mnemonic")

    // If a browser address exists, create wallet
    if (mnemonic) {
      const delegateSigner = await createWalletFromMnemonic(mnemonic)
      const address = await delegateSigner.getAddressString();
      this.setState({delegateSigner, address})
      store.dispatch({
        type: "SET_WALLET",
        text: delegateSigner
      });
    } else {// Else, we wait for user to finish selecting through modal which will refresh page when done
      this.setState({ modals: {keyGen: true} });
    }
  }

  async componentDidMount() {
    // Set up state
    await this.setWindowWeb3();
    await this.setTokenContract();
    await this.setMetamaskDetails();
    await this.setHubDetails();
    await this.setChannelManagerDetails();

    // If a browser address exists, instantiate connext
    if (this.state.delegateSigner) {
      await this.setConnext();
      await this.authorizeHandler();

      console.log(this.state.connext)
      await this.pollConnextState();
      await this.poller();
    } else {// Else, we wait for user to finish selecting through modal which will refresh page when done
      this.setState({ modals: {keyGen: true} });
    }
  }

  // ************************************************* //
  //                State setters                      //
  // ************************************************* //    

  async setWindowWeb3() {

    // Ask permission to view accounts
    if (window.ethereum) {
      window.web3 = new Web3(window.ethereum);
      try {
        // Request account access if needed
        await window.ethereum.enable();
      } catch (error) {
        console.error(error)
      }
    }

    const windowProvider = window.web3;
    if (!windowProvider) {
      alert("Metamask is not detected.");
    }
    const web3 = new Web3(windowProvider.currentProvider);
    // make sure you are on localhost
    // if (await web3.eth.net.getId() != 4447) {
    //   alert(
    //     "Uh oh! Doesn't look like you're using a local chain, please make sure your Metamask is connected appropriately to localhost:8545."
    //   );
    // } else {
    //   console.log("SETTING WEB3 ", web3)
    // }
    this.setState({web3})
    return;
  }

  async setTokenContract() {
    try {
      let { web3, tokenContract } = this.state;
      tokenContract = new web3.eth.Contract(tokenAbi, tokenAddress);
      this.setState({tokenContract});
      console.log("Set up token contract details")
    } catch (e) {
      console.log("Error setting token contract")
      console.log(e)
    }
  }

  async setMetamaskDetails() {
    try {
      let { web3, metamask, tokenContract } = this.state;
      metamask.address = (await web3.eth.getAccounts())[0].toLowerCase();
      metamask.balance = await web3.eth.getBalance(metamask.address);
      metamask.tokenBalance = await tokenContract.methods.balanceOf(metamask.address).call();
      this.setState({metamask});
      console.log("Set up metamask details")
    } catch (e) {
      console.log("Error setting Metamask details")
      console.log(e)
    }
  }

  async setChannelManagerDetails() {
    // try {
      let {web3, channelManager, tokenContract} = this.state;
      channelManager.balance = await web3.eth.getBalance(channelManager.address);
      channelManager.tokenBalance = await tokenContract.methods.balanceOf(channelManager.address.toString()).call();
      this.setState({channelManager})
      console.log("Set up channel manager details")
    // } catch (e) {
    //   console.log("Error setting Channel Manager details")
    //   console.log(e)
    // }
  }

  async setHubDetails() {
    try {
      let {web3, hubWallet, tokenContract} = this.state;
      hubWallet.balance = await web3.eth.getBalance(hubWallet.address);
      hubWallet.tokenBalance = await tokenContract.methods.balanceOf(hubWallet.address).call();
    } catch (e) {
      console.log("Error setting hub details")
      console.log(e)
    }
  }

  async setConnext() {
    const { hubWallet, channelManager, tokenContract, address } = this.state;

    const providerOpts = new ProviderOptions(store).approving();
    const provider = clientProvider(providerOpts);
    const web3 = new Web3(provider);

    const opts = {
      web3,
      hubAddress: hubWallet.address, //"0xfb482f8f779fd96a857f1486471524808b97452d" ,
      hubUrl: hubUrl, //http://localhost:8080,
      contractAddress: channelManager.address, //"0xa8c50098f6e144bf5bae32bdd1ed722e977a0a42",
      user: address,
      tokenAddress: tokenContract.options.address
    };
    console.log("Setting up connext with opts:", opts);

    // *** Instantiate the connext client ***
    const connext = getConnextClient(opts);
    console.log("Successfully set up connext!");
    this.setState({ connext, address, customWeb3: web3 });
  }

  // ************************************************* //
  //                    Pollers                        //
  // ************************************************* //   

  async pollConnextState() {
    let connext = this.state.connext
    await connext.start(); // start polling
    //console.log('Pollers started! Good morning :)')
    connext.on("onStateChange", state => {
      console.log("Connext state changed:", state);
      this.setState({
        channelState: state.persistent.channel
      });
    });
  }

  async poller() {
     await this.getRate();
     await this.browserWalletDeposit();

    setInterval(async () => {
      await this.getRate();
      await this.browserWalletDeposit();
    }, 1000)
  }
  
  async getRate() {
    const response = await fetch(
      "https://api.coinbase.com/v2/exchange-rates?currency=ETH"
    );
    const json = await response.json();
    this.setState({
      exchangeRate: json.data.rates.USD
    });
  }

  async browserWalletDeposit() {
    let address = this.state.address;
    const tokenContract = this.state.tokenContract;
    const balance = await this.state.web3.eth.getBalance(address);
    const tokenBalance = await tokenContract.methods
      .balanceOf(address)
      .call();
    if (balance !== "0" || tokenBalance !== "0") {
      if (eth.utils.bigNumberify(balance).lte(DEPOSIT_MINIMUM_WEI)) {
        // don't autodeposit anything under the threshold
        return;
      }
      // const sendArgs = {
      //   from: this.state.channelState.user
      // }
      // const gasEstimate = await approveTx.estimateGas(sendArgs)
      // if (gasEstimate > this.state.browserWalletDeposit.amountWei){
      //   throw "Not enough wei for gas"
      // }
      // if (gasEstimate < this.state.browserWalletDeposit.amountWei){
      //   const depositDiff = balance - gasEstimate
      //   this.setState({
      //     browserWalletDeposit:{
      //       amountWei: depositDiff,
      //       amountToken: tokenBalance
      //     }})
      // }
      const actualDeposit = {
        amountWei: eth.utils
          .bigNumberify(balance)
          .sub(DEPOSIT_MINIMUM_WEI)
          .toString(),
        amountToken: tokenBalance
      };
      // TODO does this need to be in the state?
      console.log(`Depositing: ${JSON.stringify(actualDeposit, null, 2)}`);
      console.log("********", this.state.connext.opts.tokenAddress);
      let depositRes = await this.state.connext.deposit(actualDeposit);
      console.log(`Deposit Result: ${JSON.stringify(depositRes, null, 2)}`);
    }
  }

  // ************************************************* //
  //                    Handlers                       //
  // ************************************************* //   

  async authorizeHandler() {
    const web3 = this.state.customWeb3;
    const challengeRes = await axios.post(`${hubUrl}/auth/challenge`, {}, opts);

    const hash = web3.utils.sha3(
      `${HASH_PREAMBLE} ${web3.utils.sha3(
        challengeRes.data.nonce
      )} ${web3.utils.sha3("localhost")}`
    );

    const signature = await web3.eth.personal.sign(hash, this.state.address);

    try {
      let authRes = await axios.post(
        `${hubUrl}/auth/response`,
        {
          nonce: challengeRes.data.nonce,
          address: this.state.address,
          origin: "localhost",
          signature
        },
        opts
      );
      const token = authRes.data.token;
      document.cookie = `hub.sid=${token}`;
      console.log(`cookie set: ${token}`);
      const res = await axios.get(`${hubUrl}/auth/status`, opts);
      if (res.data.success) {
        this.setState({ authorized: true });
        return res.data.success
      } else {
        this.setState({ authorized: false });
      }
      console.log(`Auth status: ${JSON.stringify(res.data)}`);
    } catch (e) {
      console.log(e);
    }
  }

  handleClick = event => {
    this.setState({
      anchorEl: event.currentTarget
    });
  };

  handleClose = () => {
    this.setState({
      anchorEl: null
    });
  };

  updateApprovalHandler(evt) {
    this.setState({
      approvalWeiUser: evt.target.value
    });
  }

  async collateralHandler() {
    console.log(`Requesting Collateral`);
    let collateralRes = await this.state.connext.requestCollateral();
    console.log(`Collateral result: ${JSON.stringify(collateralRes, null, 2)}`);
  }

  async approvalHandler() {
    const {tokenContract, address } = this.state;
    const web3 = this.state.customWeb3;
    const approveFor = channelManagerAddress;
    const toApprove = this.state.approvalWeiUser;
    const toApproveBn = eth.utils.bigNumberify(toApprove);
    const nonce = await web3.eth.getTransactionCount(address);
    const depositResGas = await tokenContract.methods
      .approve(approveFor, toApproveBn)
      .estimateGas();
    let tx = new Tx({
      to: tokenAddress,
      nonce: nonce,
      from: address,
      gasLimit: depositResGas * 2,
      data: tokenContract.methods.approve(approveFor, toApproveBn).encodeABI()
    });
    tx.sign(Buffer.from(this.state.delegateSigner.getPrivateKeyString().substring(2), "hex"));
    let signedTx = "0x" + tx.serialize().toString("hex");
    let sentTx = web3.eth.sendSignedTransaction(signedTx, err => {
      if (err) console.error(err);
    });
    sentTx
      .once("transactionHash", hash => {
        console.log(`tx broadcasted, hash: ${hash}`);
      })
      .once("receipt", receipt => {
        console.log(`tx mined, receipt: ${JSON.stringify(receipt)}`);
      });
    console.log(`Sent tx: ${typeof sentTx} with keys ${Object.keys(sentTx)}`);
  }

  async generateNewDelegateSigner() {
  // NOTE: DelegateSigner is always recovered from browser storage. 
  //       It is ONLY set to state from within app on load.
    await createWallet(this.state.web3);
    // Then refresh the page
    window.location.reload();
  }

  // to get tokens from metamask to browser wallet

  // ** wrapper for ethers getBalance. probably breaks for tokens

  render() {
    const { anchorEl } = this.state;
    const open = Boolean(anchorEl);
    return (
      <div>
        <AppBar position="sticky" elevation="0" color="secondary" style={{paddingTop: "2%"}}>
          <Toolbar>
            <img src={blockies.createDataURL({seed: this.state.address})} alt={noAddrBlocky} style={{ width: "40px", height: "40px", marginTop: "5px" }} />
            <Typography variant="body2" noWrap style={{ width: "75px", marginLeft: "6px", color: "#c1c6ce"}}>
              {this.state.address}
            </Typography>
            <Typography variant="h6" style={{ flexGrow: 1 }} />
            <IconButton
              color="inherit"
              aria-label="Menu"
              aria-owns={open ? "settings" : undefined}
              aria-haspopup="true"
              variant="contained"
              onClick={this.handleClick}
            >
              <SettingIcon />
            </IconButton>
            <Typography variant="subtitle1">
            <CopyToClipboard
              // style={cardStyle.clipboard}
              text={(this.props.address)}
            >
              <Tooltip
                disableFocusListener
                disableTouchListener
                title="Click to Copy"
              >
                <span>{this.props.address}</span>
              </Tooltip>
            </CopyToClipboard>
          </Typography>
            <Popover
              id="settings"
              open={open}
              anchorEl={anchorEl}
              onClose={this.handleClose}
              anchorOrigin={{
                vertical: "bottom",
                horizontal: "center"
              }}
              transformOrigin={{
                vertical: "top",
                horizontal: "center"
              }}
              style={{ width: "100%" }}
            >
              <div className="modal_inner">
                <div className="row">
                  {this.state.delegateSigner? (
                    <div className="column">
                      <div>
                        <h4>
                          You have a delegate signer set up already! <br />
                          You can get your current mnemonic, recover an 
                          old signer from a mnemonic , or
                          set up an entirely delegate signer.{" "}
                        </h4>
                      </div>
                      <div>
                        {this.setState.showMnemonic ? (
                          <div>
                            <Button
                              style={{
                                padding: "15px 15px 15px 15px",
                                marginRight: "15px"
                              }}
                              variant="contained"
                              color="primary"
                              onClick={() =>
                                this.setState({showMnemonic: true})
                              }
                            >
                              See Mnemonic (click to copy)
                            </Button>
                          </div>
                        ) : (
                          <div>
                            <TextField
                              id="outlined-with-placeholder"
                              label="Mnemonic"
                              value={this.state.delegateSigner.mnemonic}
                              onChange={evt =>
                                this.updateWalletHandler(evt)
                              }
                              placeholder="12 word passphrase (e.g. hat avocado green....)"
                              margin="normal"
                              variant="outlined"
                              fullWidth
                            />
                            <CopyToClipboard
                              style={{ cursor: "pointer" }}
                              text={this.state.delegateSigner.mnemonic}
                            >
                              <span>{this.state.delegateSigner.mnemonic}</span>
                            </CopyToClipboard>
                            <Button
                              variant="contained"
                              color="primary"
                              onClick={evt => this.setState({showMnemonic: false})}
                            >
                              Hide Mnemonic
                            </Button>
                          </div>
                        )}
                        <Button
                          style={{ padding: "15px 15px 15px 15px" }}
                          variant="contained"
                          color="primary"
                          onClick={() => this.generateNewDelegateSigner()}
                        >
                          Create New Signer (will refresh page)
                        </Button>
                      </div>
                      <div>
                        {/* <TextField
                          id="outlined-with-placeholder"
                          label="Recover Signer"
                          value={this.state.delegateSigner.mnemonic}
                          onS={evt =>
                            this.updateWalletHandler(evt)
                          }
                          placeholder="12 word passphrase (e.g. hat avocado green....)"
                          margin="normal"
                          variant="outlined"
                          fullWidth
                        /> */}
                        <Button
                            style={{ padding: "15px 15px 15px 15px" }}
                            variant="contained"
                            color="primary"
                            onClick={() => this.generateNewDelegateSigner()}
                          >
                          Recover delegate signer from mnemonic (does nothing for now)
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="column">
                        <Button
                          style={{ padding: "15px 15px 15px 15px" }}
                          variant="contained"
                          color="primary"
                          onClick={() => this.generateNewDelegateSigner()}
                        >
                          Create New Signer (will refresh page)
                        </Button>
                    </div>
                  )}
                </div>
              </div>
            </Popover>
          </Toolbar>
        </AppBar>
        <div className="app">
          <div className="row" style={{marginBottom: "-7.5%"}}>
            <div
              className="column"
              style={{ justifyContent: "space-between", flexGrow: 1 }}
            >
              <ChannelCard
                channelState={this.state.channelState}
                address={this.state.address}
              />
            </div>
          </div>
          <div className="row">
            <div className="column" style={{marginRight: "5%", marginLeft: "80%"}}>
              <Fab
                style={{
                  color: "#FFF",
                  backgroundColor: "#fca311",
                  size: "large",
                }}
              >
              <QRIcon/>
              </Fab>
            </div>
          </div>
          <div className="row" style={{marginTop: "17.5%", marginBottom: "5%"}}>
            <div className="column" style={{marginLeft: "5%"}}>
              <Button
                style={{
                  marginRight: "5px",
                  color: "#FFF",
                  backgroundColor: "#FCA311"
                }}
                variant="contained"
                size="large"
                onClick={() => this.setState({modals: {receive: true}})}
              >
                Receive
              <ReceiveIcon style={{marginLeft: "5px"}}/>
              </Button>
              <Modal
               open={this.state.modals.receive} 
               onClose={() => this.setState({modals: {receive: false}})}
               style={{display: "flex", justifyContent:"center", alignItems:"center"}}
              >
                <ReceiveCard
                  address={this.state.address}
                />
              </Modal>
            </div>
            <div className="column" style={{marginRight:"5%"}}>
              <Button
                style={{
                  marginLeft: "5px",
                  color: "#FFF",
                  backgroundColor: "#FCA311"
                }}
                size="large"
                variant="contained"
                onClick={() => this.setState({modals: {send: true}})}
              >
                Send
                <SendIcon style={{marginLeft: "5px"}}/>
              </Button>
              <Modal
               open={this.state.modals.send} 
               onClose={() => this.setState({modals: {send: false}})}
               style={{display: "flex", justifyContent:"center", alignItems:"center"}}
              >
                <SendCard />
              </Modal>
            </div>
          </div>
          <div className="row" style={{ paddingTop: "5%", justifyContent: "center"}}>
            <Button
              color="primary"
              variant="outlined"
              size="large"
              onClick={() => this.setState({modals: {cashOut: true}})}
            >
              Cash Out
            </Button>
            <Modal
              open={this.state.modals.cashOut}
              onClose={() => this.setState({modals: {cashOut: false}})}
              style={{display: "flex", justifyContent:"center", alignItems:"center"}}
            >
              <CashOutCard/>
            </Modal>
          </div>
        </div>
      </div>
    );
  }
}

export default App;