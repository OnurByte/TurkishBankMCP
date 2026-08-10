# TurkishBankMCP

TurkishBankMCP tamamen açık kaynak ve MIT lisanslı bir proje

Şu an direkt Garanti BBVA API Store ile çalışıyor

Arada Kobaküs yok başka aggregator yok direkt Garanti

Amaç basit

Hermes OpenClaw veya başka bir MCP istemcisi hesap bilgini ve hesap hareketlerini okuyabilsin

Para gönderme ödeme başlatma EFT kart yönetme satın alma gibi şeyler yok

Kodda bunlara ait tool da yok

## Garanti tarafında ne lazım

Garanti Developer Portal hesabı aç

Manage -> Applications -> Add Application yolundan yeni app oluştur

API Management kısmında sadece şunları seç

- Account Information
- Account Transactions

Başka ödeme transfer tahsilat API'si ekleme

Authentication kısmında callback URL HTTPS ve dışarıdan erişilebilir olmalı

Scope alanına `OOB`

Type alanına `Confidential`

Submit edince `Client ID` ve `Client Secret` geliyor

App önce Pending Approval olur

Garanti onayladıktan sonra canlı isteklere geçebilirsin

OAuth tarafını TurkishBankMCP kendi yapıyor

Garanti'nin resmi token endpointi hazır tanımlı

```text
https://apis.garantibbva.com.tr/auth/oauth/v2/token
```

`client_credentials` ile token alıyor

Token hiçbir MCP cevabında gösterilmiyor

## Neden endpointleri env içine yazıyoruz

Garanti public sayfasında Account Information ve Account Transactions ürünlerinin varlığını gösteriyor

Ama bu ürünlerin gerçek endpoint path request method ve body şeması login arkasındaki API ekranında görünüyor

O yüzden burada path uydurmuyoruz

Portal sana ne gösteriyorsa aynısını `.env` içine koyuyorsun

Bu daha güvenli ve production için daha doğru

## .env

Önce

```bash
cp .env.example .env
```

Sonra

```dotenv
GARANTI_CLIENT_ID=
GARANTI_CLIENT_SECRET=
GARANTI_REDIRECT_URI=https://senin-domainin.com/callback

GARANTI_ACCOUNT_INFORMATION_URL=
GARANTI_ACCOUNT_INFORMATION_METHOD=
GARANTI_ACCOUNT_INFORMATION_CONTENT_TYPE=application/json
GARANTI_ACCOUNT_INFORMATION_BODY_TEMPLATE=

GARANTI_ACCOUNT_TRANSACTIONS_URL=
GARANTI_ACCOUNT_TRANSACTIONS_METHOD=
GARANTI_ACCOUNT_TRANSACTIONS_CONTENT_TYPE=application/json
GARANTI_ACCOUNT_TRANSACTIONS_BODY_TEMPLATE=
```

Transaction URL veya body içinde şu alanları kullanabilirsin

```text
{{accountRef}}
{{from}}
{{to}}
{{direction}}
{{minAmount}}
{{maxAmount}}
{{page}}
{{pageSize}}
```

Mesela Garanti dokümanı account id ve tarihleri query string içinde istiyorsa URL template kullanırsın

Body içinde istiyorsa body template kullanırsın

Kod GET ve POST destekliyor

JSON ve form-urlencoded body destekliyor

## Client Secret dosyada dursun istersen

`.env` içine secret yazmak zorunda değilsin

```dotenv
GARANTI_CLIENT_SECRET_FILE=.secrets/garanti-client-secret
```

Dosya içindeki secret token yenilenirken tekrar okunur

## İlk test

Kurulum

```bash
git clone git@github.com:OnurByte/TurkishBankMCP.git
cd TurkishBankMCP
npm install
cp .env.example .env
npm run check
npm run build
```

MCP Inspector aç

```bash
npm run inspect
```

İlk önce

```text
bank_provider_status
```

Sonra

```text
bank_test_connection
```

Bu sadece OAuth bağlantısını test eder

Başarılıysa

```json
{
  "provider": "garanti-api-store",
  "oauth": "ok",
  "readOnly": true
}
```

görürsün

Access tokenı göstermez

Sonra

```text
bank_list_accounts
```

ve

```text
bank_list_transactions
```

ile gerçek API'yi test edebilirsin

## MCP tool'ları

```text
bank_provider_status
bank_test_connection
bank_list_accounts
bank_get_balances
bank_list_transactions
```

Hepsi read-only olarak işaretli

## Hermes

Build aldıktan sonra

```yaml
mcp_servers:
  turkish_bank:
    command: "node"
    args:
      - "/absolute/path/to/TurkishBankMCP/dist/index.js"
```

Sonra mesela

```text
Bugünkü hesap hareketlerime bak
ne kadar para geldi ne kadar çıktı söyle
tekrarlayan harcamaları bul
bana kısa bir finans özeti çıkar
hiçbir finansal işlem yapma
```

diyebilirsin

Şu an Garanti response şeması public dokümanda yayınlanmadığı için MCP bankadan gelen Account Information ve Account Transactions cevabını bozmadan döndürüyor

İlk gerçek response geldiğinde normalizerı o gerçek şemaya göre sabitlemek daha doğru

## Güvenlik

Portal app'ine sadece Account Information ve Account Transactions yetkisi ver

Client Secret ve token MCP tool çıktısına girmez

401 gelirse token bir kere otomatik yenilenir

429 ve geçici 5xx hatalarında kontrollü retry var

Endpoint URL'sinde transfer payment EFT tahsilat kredi kart yönetimi gibi ifadeler varsa config güvenlik için reddedilir

TurkishBankMCP içinde ödeme veya transfer tool'u yok

Hermes'e ayrıca sınırsız shell ve filesystem yetkisi verirsen o ayrı güvenlik sınırı

## Sıkça sorulan sorular

### Bu proje ücretsiz mi

Evet proje tamamen açık kaynak ve ücretsiz

Garanti API Store'un canlı kullanım şartları ise Garanti'nin onayına bağlı

### Banka şifremi girmem gerekiyor mu

Hayır bu entegrasyon internet bankacılığı şifresiyle çalışmıyor

Developer Portal üzerinden verilen Client ID ve Client Secret kullanılıyor

### AI para gönderebilir mi

Bu MCP üzerinden hayır

Ödeme transfer EFT veya kart yönetim tool'u yok

### Token Hermes'e gider mi

Hayır

Token sadece provider içinde kullanılıyor

### Neden endpoint URL'sini kendim yazıyorum

Çünkü Garanti ürün endpointlerini ve request şemasını portal içindeki API dokümanında gösteriyor

Public sayfada bunların path'i yayınlanmıyor

### Callback URL şart mı

Garanti'nin kendi FAQ dokümanına göre evet

HTTPS ve dışarıdan erişilebilir olmalı

### Önce sadece OAuth test edebilir miyim

Evet `bank_test_connection` bunun için var

### App'e başka Garanti API'leri ekleyebilir miyim

Bu proje için ekleme

Sadece Account Information ve Account Transactions seçmek en güvenlisi

### Response neden normalize edilmiyor

Garanti'nin gerçek response şemasını görmeden alan adı uydurmak istemiyoruz

İlk canlı veya sandbox response ile normalizer eklenebilir

### Projeye katkı verebilir miyim

Tabii

Repo açık kaynak

## Kaynaklar

- Garanti API Developer Portal: https://developers.garantibbva.com.tr/
- Garanti API Store FAQ: https://developers.garantibbva.com.tr/pages/SSS.html

## Lisans

MIT
