# Кастомный токен и Scroll мост L1/L2

Этот проект демонстрирует создание кастомных токенов и мостов для их передачи между Ethereum (L1) и Scroll (L2).

## Содержание

- [Установка](#установка)
- [Конфигурация](#конфигурация)
- [Использование](#использование)
  - [Деплой контрактов](#деплой-контрактов)
  - [Перевод токенов с L1 на L2](#перевод-токенов-с-l1-на-l2)
  - [Перевод токенов с L2 на L1](#перевод-токенов-с-l2-на-l1)
  - [Клейм токенов с L2 на L1](#клейм-токенов-с-l2-на-l1)
- [Принцип работы](#принцип-работы)
  - [Архитектура моста](#архитектура-моста)
  - [Передача сообщений](#передача-сообщений)
  - [Процесс клейма](#процесс-клейма)
  - [Газовые комиссии](#газовые-комиссии)

## Установка

1. Клонирование репозитория:
   ```bash
   git clone <url-репозитория>
   cd <директория-проекта>
   ```

2. Установка зависимостей:
   ```bash
   npm install
   ```

3. Убедитесь, что у вас настроен доступ к локальным узлам Scroll (файл hardhat.config.js):
   - L1 сеть: http://l1-devnet.scrollsdk
   - L2 сеть: http://l2-rpc.scrollsdk

4. Также в файл hardhat.config.js нужно вписать ваш приватный ключ

5. Скомпилируйте все файлы
   ```bash
   npx hardhat compile
   ```
   
## Конфигурация

Проект использует Hardhat для деплоя контрактов и выполнения скриптов. Конфигурация находится в `hardhat.config.js`.

Основные файлы:
- `contracts/` - смарт-контракты (токены L1/L2 и мосты)
- `scripts/` - скрипты для деплоя и взаимодействия с контрактами
- `addresses.json` - адреса задеплоенных контрактов (генерируется автоматически)
- `claim.config.js` - конфигурация для скрипта клейма токенов с L2 на L1

## Использование

### Деплой контрактов

Для деплоя всех необходимых контрактов выполните:

```bash
npx hardhat run scripts/deploy.js --network l1_scrollsdk
```

Этот скрипт выполнит следующие действия:
1. Деплой L1CustomToken на L1
2. Деплой L1TokenBridge на L1
3. Деплой L2TokenBridge на L2
4. Деплой L2CustomToken на L2
5. Инициализацию обоих мостов
6. Сохранение адресов контрактов в `addresses.json`

### Перевод токенов с L1 на L2

```bash
npx hardhat run scripts/bridgeL1ToL2.js --network l1_scrollsdk
```

Этот скрипт:
1. Проверяет наличие токенов на L1 (если их нет, минтит новые)
2. Одобряет мост на использование токенов
3. Отправляет токены через мост на L2
4. Выводит хэш транзакции

### Перевод токенов с L2 на L1

```bash
npx hardhat run scripts/bridgeL2ToL1.js --network l2_scrollsdk
```

Этот скрипт:
1. Проверяет наличие токенов на L2
2. Рассчитывает газовую комиссию для выполнения транзакции на L1
3. Отправляет токены через мост на L1
4. Выводит хэш транзакции

### Клейм токенов с L2 на L1

После отправки токенов с L2 на L1, необходимо выполнить процедуру клейма для получения токенов на L1:

1. Обновите хэш транзакции в файле `claim.config.js`:
   ```javascript
   module.exports = {
     TX_HASH: "ваш-хэш-транзакции-перевода-с-L2-на-L1"
   };
   ```

2. Запустите скрипт клейма:
   ```bash
   npx hardhat run scripts/claimL2ToL1.js --network l1_scrollsdk
   ```

## Принцип работы

### Архитектура моста

Система состоит из четырех основных компонентов:
1. **L1CustomToken** - ERC20 токен на Ethereum (L1)
2. **L2CustomToken** - ERC20 токен на Scroll (L2), совместимый с интерфейсом IScrollERC20Extension
3. **L1TokenBridge** - мост на L1, отвечающий за блокировку токенов и отправку сообщений на L2
4. **L2TokenBridge** - мост на L2, отвечающий за минтинг/сжигание токенов и отправку сообщений на L1

Мосты взаимодействуют с системными контрактами Scroll:
- **L1ScrollMessenger** - контракт на L1 для отправки сообщений на L2
- **L2ScrollMessenger** - контракт на L2 для отправки сообщений на L1

### Передача сообщений

#### L1 → L2 (Депозит):
1. Пользователь вызывает `bridgeToken` на L1TokenBridge, передавая ETH для оплаты газа на L2
2. L1TokenBridge переводит токены с кошелька пользователя на себя (lock)
3. L1TokenBridge формирует сообщение с вызовом `finalizeDepositERC20` и отправляет его через L1ScrollMessenger
4. Сообщение попадает в L1MessageQueue
5. Релеер Scroll обнаруживает сообщение и отправляет его на L2
6. На L2 вызывается L2TokenBridge.finalizeDepositERC20, который минтит токены получателю

#### L2 → L1 (Вывод):
1. Пользователь вызывает `bridgeToken` на L2TokenBridge, передавая ETH для оплаты газа на L1
2. L2TokenBridge сжигает токены пользователя (burn)
3. L2TokenBridge формирует сообщение с вызовом `finalizeWithdrawERC20` и отправляет его через L2ScrollMessenger
4. Сообщение записывается в L2MessageQueue в бинарное дерево Меркла (withdraw tree)
5. Для завершения процесса требуется клейм на L1

### Процесс клейма

После отправки токенов с L2 на L1 требуется дополнительный шаг - клейм:

1. Пользователь получает доказательство Меркла через API Bridge History
2. Пользователь вызывает `relayMessageWithProof` на L1ScrollMessenger, передавая:
   - Адрес отправителя сообщения (L2TokenBridge)
   - Адрес получателя (L1TokenBridge)
   - Значение (обычно 0)
   - Nonce сообщения
   - Данные сообщения (закодированный вызов finalizeWithdrawERC20)
   - Доказательство (batchIndex и merkleProof)
3. L1ScrollMessenger проверяет доказательство и вызывает finalizeWithdrawERC20 на L1TokenBridge
4. L1TokenBridge разблокирует и переводит токены пользователю

### Газовые комиссии

#### L1 → L2:
- Требуется передать ETH вместе с транзакцией для оплаты газа на L2
- Для стандартных операций обычно достаточно 0.01 ETH
- Неиспользованный ETH возвращается отправителю

#### L2 → L1:
- Требуется передать ETH вместе с транзакцией для оплаты газа на L1
- Для расчета комиссии используется формула: L1 gasPrice * gasLimit
- Для стандартных операций обычно достаточно 0.05 ETH (зависит от загрузки L1)

При клейме токенов с L2 на L1 также требуется оплатить газ за выполнение транзакции клейма на L1. 
