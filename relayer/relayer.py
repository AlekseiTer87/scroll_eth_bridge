import os
import json
import time
import requests
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

L1_RPC_URL = os.getenv("L1_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
L2_RPC_URL = os.getenv("L2_RPC_URL", "https://sepolia-rpc.scroll.io/")
BRIDGE_HISTORY_API = os.getenv("BRIDGE_HISTORY_API", "https://sepolia-api-bridge-v2.scroll.io")
PRIVATE_KEY = os.getenv("RELAYER_PRIVATE_KEY", "0x")

# Пути к файлам состояния
PROCESSED_FILE = os.path.join(os.path.dirname(__file__), "processed.txt")
PENDING_ETH_FILE = os.path.join(os.path.dirname(__file__), "pending_eth.txt")
PENDING_TOKEN_FILE = os.path.join(os.path.dirname(__file__), "pending_token.txt")

# Загрузка адресов
with open(os.path.join(os.path.dirname(__file__), "..", "bridge_deployment", "addresses.json")) as f:
    addresses = json.load(f)

L1_TOKEN_BRIDGE_ADDRESS = Web3.to_checksum_address(addresses["token"]["l1"]["bridge"])
L2_TOKEN_BRIDGE_ADDRESS = Web3.to_checksum_address(addresses["token"]["l2"]["bridge"])
L1_ETH_BRIDGE_ADDRESS = Web3.to_checksum_address(addresses["eth"]["l1"]["bridge"])
L2_ETH_BRIDGE_ADDRESS = Web3.to_checksum_address(addresses["eth"]["l2"]["bridge"])

# Web3 подключение
w3_l1 = Web3(Web3.HTTPProvider(L1_RPC_URL))
w3_l2 = Web3(Web3.HTTPProvider(L2_RPC_URL))
account = Account.from_key(PRIVATE_KEY)

# Загрузка состояния
def load_state():
    processed = set()
    pending_eth = set()
    pending_token = set()
    
    if os.path.exists(PROCESSED_FILE):
        with open(PROCESSED_FILE, 'r') as f:
            processed = set(line.strip() for line in f if line.strip())
    
    if os.path.exists(PENDING_ETH_FILE):
        with open(PENDING_ETH_FILE, 'r') as f:
            pending_eth = set(line.strip() for line in f if line.strip())
            
    if os.path.exists(PENDING_TOKEN_FILE):
        with open(PENDING_TOKEN_FILE, 'r') as f:
            pending_token = set(line.strip() for line in f if line.strip())
    
    return processed, pending_eth, pending_token

def save_processed(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    with open(PROCESSED_FILE, "a") as f:
        f.write(tx_hash + "\n")
    processed.add(tx_hash)
    # Удаляем из обоих pending файлов
    remove_pending_eth(tx_hash)
    remove_pending_token(tx_hash)

def save_pending_eth(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    if tx_hash not in pending_eth:
        with open(PENDING_ETH_FILE, "a") as f:
            f.write(tx_hash + "\n")
        pending_eth.add(tx_hash)

def save_pending_token(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    if tx_hash not in pending_token:
        with open(PENDING_TOKEN_FILE, "a") as f:
            f.write(tx_hash + "\n")
        pending_token.add(tx_hash)

def remove_pending_eth(tx_hash):
    if tx_hash in pending_eth:
        pending_eth.discard(tx_hash)
        with open(PENDING_ETH_FILE, "w") as f:
            for h in pending_eth:
                f.write(h + "\n")

def remove_pending_token(tx_hash):
    if tx_hash in pending_token:
        pending_token.discard(tx_hash)
        with open(PENDING_TOKEN_FILE, "w") as f:
            for h in pending_token:
                f.write(h + "\n")

# ABI для событий
WITHDRAW_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "internalType": "address", "name": "l1Token", "type": "address"},
        {"indexed": True, "internalType": "address", "name": "l2Token", "type": "address"},
        {"indexed": True, "internalType": "address", "name": "from", "type": "address"},
        {"indexed": False, "internalType": "address", "name": "to", "type": "address"},
        {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
        {"indexed": False, "internalType": "bytes", "name": "data", "type": "bytes"}
    ],
    "name": "WithdrawERC20",
    "type": "event"
}

ETH_WITHDRAWN_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "internalType": "address", "name": "from", "type": "address"},
        {"indexed": True, "internalType": "address", "name": "to", "type": "address"},
        {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
        {"indexed": False, "internalType": "bytes", "name": "data", "type": "bytes"}
    ],
    "name": "ETHWithdrawn",
    "type": "event"
}

def get_proof_for_tx(tx_hash):
    url = f"{BRIDGE_HISTORY_API}/api/txsbyhashes"
    try:
        resp = requests.post(url, json={"txs": [tx_hash]})
        resp.raise_for_status()
        data = resp.json()
        if data.get("errcode", 1) != 0:
            print(f"Ошибка Bridge History API: {data.get('errmsg')}")
            return None
        items = data["data"]["results"]
        if not items:
            return None
        return items[0]
    except Exception as e:
        print(f"Ошибка запроса к Bridge History API для {tx_hash}: {e}")
        return None

def relay_withdrawal(tx_hash, is_eth=False):
    if tx_hash in processed:
        print(f"{tx_hash} - Транзакция уже обработана")
        return True

    proof_data = get_proof_for_tx(tx_hash)
    if not proof_data or not proof_data.get("claim_info"):
        print(f"{tx_hash} -Нет данных для подтверждения транзакции")
        if is_eth:
            save_pending_eth(tx_hash)
        else:
            save_pending_token(tx_hash)
        return False

    claim = proof_data["claim_info"]
    if not claim.get("proof") or not claim["proof"].get("batch_index") or not claim["proof"].get("merkle_proof"):
        print(f"{tx_hash} - Транзакция пока не готова к подтверждению (нет proof)")
        if is_eth:
            save_pending_eth(tx_hash)
        else:
            save_pending_token(tx_hash)
        return False

    if not (claim.get("claimable") is True or claim.get("claimable") == "true"):
        print(f"{tx_hash} - Транзакция пока не готова к подтверждению")
        if is_eth:
            save_pending_eth(tx_hash)
        else:
            save_pending_token(tx_hash)
        return False

    try:
        # Подготовка данных для вызова relayMessageWithProof
        from_addr = claim["from"]
        value = int(claim["value"])
        message_nonce = int(claim["nonce"])
        message = bytes.fromhex(claim["message"][2:]) if claim["message"].startswith("0x") else bytes.fromhex(claim["message"])
        proof = claim["proof"]
        batch_index = int(proof["batch_index"])
        merkle_proof = bytes.fromhex(proof["merkle_proof"][2:]) if proof["merkle_proof"].startswith("0x") else bytes.fromhex(proof["merkle_proof"])

        # Определяем адрес моста и мессенджера
        bridge_address = L1_ETH_BRIDGE_ADDRESS if is_eth else L1_TOKEN_BRIDGE_ADDRESS
        
        # Получаем адрес мессенджера из контракта моста
        bridge_contract = w3_l1.eth.contract(
            address=bridge_address,
            abi=[{"inputs": [], "name": "messenger", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"}]
        )
        messenger_address = bridge_contract.functions.messenger().call()
        
        # Создаем контракт мессенджера
        messenger_contract = w3_l1.eth.contract(
            address=messenger_address,
            abi=[{
                "inputs": [
                    {"internalType": "address", "name": "_sender", "type": "address"},
                    {"internalType": "address", "name": "_target", "type": "address"},
                    {"internalType": "uint256", "name": "_value", "type": "uint256"},
                    {"internalType": "uint256", "name": "_messageNonce", "type": "uint256"},
                    {"internalType": "bytes", "name": "_message", "type": "bytes"},
                    {"components": [
                        {"internalType": "uint256", "name": "batchIndex", "type": "uint256"},
                        {"internalType": "bytes", "name": "merkleProof", "type": "bytes"}
                    ], "internalType": "struct IL1ScrollMessenger.L2MessageProof", "name": "_proof", "type": "tuple"}
                ],
                "name": "relayMessageWithProof",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            }]
        )

        print(f"Отправляем подтверждение для {'ETH' if is_eth else 'Token'} транзакции {tx_hash}")
        print(f"От: {from_addr}")
        print(f"Сумма: {value}")
        print(f"Nonce: {message_nonce}")

        # Получаем текущий gas price и увеличиваем его на 20%
        gas_price = w3_l1.eth.gas_price
        gas_price = int(gas_price * 1.2)

        # Отправляем транзакцию
        tx = messenger_contract.functions.relayMessageWithProof(
            from_addr,
            bridge_address,
            value,
            message_nonce,
            message,
            (batch_index, merkle_proof)
        ).build_transaction({
            "from": account.address,
            "nonce": w3_l1.eth.get_transaction_count(account.address),
            "gas": 2000000,
            "gasPrice": gas_price
        })

        signed_tx = account.sign_transaction(tx)
        tx_hash_l1 = w3_l1.eth.send_raw_transaction(signed_tx.rawTransaction)
        print(f"Отправлена транзакция подтверждения: {tx_hash_l1.hex()}")
        
        # Ждем подтверждения транзакции
        receipt = w3_l1.eth.wait_for_transaction_receipt(tx_hash_l1)
        if receipt.status == 1:
            print(f"Транзакция успешно подтверждена")
            save_processed(tx_hash)
            return True
        else:
            print(f"Ошибка при подтверждении транзакции")
            return False

    except Exception as e:
        print(f"Ошибка при отправке транзакции: {e}")
        return False

def process_pending():
    # Проверяем ETH транзакции
    print(f"Проверка отложенных ETH транзакций ({len(pending_eth)} шт.)")
    for tx_hash in list(pending_eth):
        print(f"Проверка отложенной ETH транзакции: {tx_hash}")
        if relay_withdrawal(tx_hash, is_eth=True):
            print(f"{tx_hash} - Успешно обработана отложенная ETH транзакция")
        else:
            print(f"{tx_hash} - ETH транзакция все еще не готова к подтверждению")

    # Проверяем Token транзакции
    print(f"Проверка отложенных Token транзакций ({len(pending_token)} шт.)")
    for tx_hash in list(pending_token):
        print(f"Проверка отложенной Token транзакции: {tx_hash}")
        if relay_withdrawal(tx_hash, is_eth=False):
            print(f"{tx_hash} - Успешно обработана отложенная Token транзакция")
        else:
            print(f"{tx_hash} - Token транзакция все еще не готова к подтверждению")

def main_loop():
    global processed, pending_eth, pending_token
    processed, pending_eth, pending_token = load_state()
    
    print(f"Релеер запущен. Адрес: {account.address}")
    print(f"Загружено:")
    print(f"- {len(processed)} обработанных транзакций")
    print(f"- {len(pending_eth)} ожидающих ETH транзакций")
    print(f"- {len(pending_token)} ожидающих Token транзакций")
    print(f"Отслеживаем события на L2:")
    print(f"Token Bridge: {L2_TOKEN_BRIDGE_ADDRESS}")
    print(f"ETH Bridge: {L2_ETH_BRIDGE_ADDRESS}")

    # Создаем фильтры для событий
    l2_token_bridge = w3_l2.eth.contract(address=L2_TOKEN_BRIDGE_ADDRESS, abi=[WITHDRAW_EVENT_ABI])
    l2_eth_bridge = w3_l2.eth.contract(address=L2_ETH_BRIDGE_ADDRESS, abi=[ETH_WITHDRAWN_EVENT_ABI])

    # Получаем текущий блок
    last_block = w3_l2.eth.block_number

    while True:
        try:
            # Сначала проверяем отложенные транзакции
            process_pending()

            current_block = w3_l2.eth.block_number
            if current_block > last_block:
                print(f"Проверка новых блоков от {last_block + 1} до {current_block}")
                
                # Получаем события вывода токенов
                token_events = l2_token_bridge.events.WithdrawERC20.get_logs(fromBlock=last_block + 1, toBlock=current_block)
                for event in token_events:
                    tx_hash = event["transactionHash"].hex()
                    print(f"Найдено событие вывода токена: {tx_hash}")
                    if tx_hash not in processed:
                        if not relay_withdrawal(tx_hash, is_eth=False):
                            save_pending_token(tx_hash)

                # Получаем события вывода ETH
                eth_events = l2_eth_bridge.events.ETHWithdrawn.get_logs(fromBlock=last_block + 1, toBlock=current_block)
                for event in eth_events:
                    tx_hash = event["transactionHash"].hex()
                    print(f"Найдено событие вывода ETH: {tx_hash}")
                    if tx_hash not in processed:
                        if not relay_withdrawal(tx_hash, is_eth=True):
                            save_pending_eth(tx_hash)

                last_block = current_block

            time.sleep(30)  # Проверяем каждые 30 секунд

        except Exception as e:
            print(f"Ошибка в главном цикле: {e}")
            time.sleep(60)  # В случае ошибки ждем дольше

if __name__ == "__main__":
    main_loop()
