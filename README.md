# TurkishBankMCP

Türk banka hesaplarını MCP üzerinden Hermes OpenClaw ve benzeri ajanlara bağlamak için yazılmış read-only bir sunucu.

Amaç basit. Ajan bakiyeni ve hesap hareketlerini okuyabilsin. Günlük ne kadar para girmiş ne kadar çıkmış görebilsin. Harcamaları yorumlayabilsin. Bütçe analizi yapabilsin.

Bu proje para göndermez. Ödeme başlatmaz. Alışveriş yapmaz. Karttan para çekmez.

Kodda bunlara ait bir MCP tool yok.

## Ne okuyabiliyor

- banka hesapları
- güncel bakiye
- kullanılabilir bakiye
- bloke bakiye
- gelen para
- giden para
- hesap hareketleri
- günlük ve tarih aralıklı nakit akışı

Kartlara özel endpointler doğrudan ÖHVPS bağlantısında var. Kobaküsün public KWAP dokümanı şu an sadece `Accounts` ve `Transactions` çağrılarını yayınlıyor. Bu yüzden Kobaküs providerında kart tool'ları kapalı.

## En kolay kurulum: Kobaküs

Gerçek banka hesabını bağlamak için en kolay yol şu an Kobaküs.

Kobaküs KWAP tek endpoint kullanıyor.

```text
POST https://app.kobakus.com/webservice/BankPaymentList.php
```

Hesap ve bakiye için:

```text
requestMethod=Accounts
```

Hesap hareketleri için:

```text
requestMethod=Transactions
```

Garanti BBVA Kobaküs tarafında AIS canlı olarak listeleniyor. Bakiye ve işlem okuma destekleniyor. Aynı bağlantı modeli diğer desteklenen bankalarda da kullanılıyor.

TurkishBankMCP Kobaküsün ödeme API'sini kullanmaz. Sadece yukarıdaki iki read-only çağrıyı yapar.

### Kobaküs ayarı

`.env`:

```dotenv
BANK_PROVIDER=kobakus

KOBAKUS_FIRM_CODE=
KOBAKUS_CHANNEL_CODE=
KOBAKUS_PASSWORD=
```

İstersen şifreyi `.env` içine koymak yerine dosyadan okutabilirsin.

```dotenv
KOBAKUS_PASSWORD_FILE=.secrets/kobakus-password
```

Kobaküs canlı erişimde `firmCode` `password` ve `channelCode` veriyor. Public dokümana göre canlı servis için IP tanımı da istenebiliyor.

Sandbox ile önce bağlantıyı test etmek daha mantıklı.

## Doğrudan ÖHVPS

Yetkili YÖS/HBHS veya ÖHVPS uyumlu bir gateway erişimin varsa `ohvps` providerını kullanabilirsin.

```dotenv
BANK_PROVIDER=ohvps
OHVPS_SPEC_VERSION=2.0.0

OHVPS_BASE_URL=
OHVPS_TPP_CODE=
OHVPS_ASPSP_CODE=
OHVPS_GATEWAY_TOKEN=
OHVPS_ACCESS_TOKEN=
```

Bu yol daha düşük seviyeli. Sertifika rıza token ve kurum erişimi tarafını senin providerın çözmüş olmalı.

Normal bir bireysel banka müşterisinin doğrudan BKM'den API key alması için yapılmış bir akış değil.

## Kurulum

Node.js 22 veya üstü.

```bash
git clone git@github.com:OnurByte/TurkishBankMCP.git
cd TurkishBankMCP

npm install
cp .env.example .env

npm run check
npm run build
```

Banka bilgisi olmadan denemek için:

```dotenv
BANK_PROVIDER=mock
```

Sonra:

```bash
npm start
```

## Hermes

Build aldıktan sonra Hermes configine ekle.

```yaml
mcp_servers:
  turkish_bank:
    command: "node"
    args:
      - "/absolute/path/to/TurkishBankMCP/dist/index.js"
```

Sonra Hermes'e mesela şunu diyebilirsin:

```text
Her gün akşam hesap hareketlerime bak.
Bugün toplam ne kadar para geldi ne kadar çıktı söyle.
Son 7 günle kıyasla.
Dikkat çeken harcamaları yaz.
Bana kısa bir bütçe özeti çıkar.
Hiçbir finansal işlem yapma.
```

Cron tarafını Hermes veya kullandığın agent runtime yönetir. MCP sadece veriyi okur.

## MCP tool'ları

```text
bank_provider_status
bank_list_accounts
bank_get_balances
bank_list_transactions
bank_cashflow_summary
bank_daily_cashflow
bank_monthly_cashflow
bank_list_cards
bank_list_card_transactions
bank_card_spending_summary
```

Bütün tool'lar read-only olarak işaretli.

Kobaküs kullanırken ilk 7 tool çalışır. Kartla ilgili son 3 tool public KWAP sözleşmesinde kart endpointi olmadığı için açık hata döner.

Doğrudan ÖHVPS providerında kart tool'ları da kullanılabilir.

## Kobaküs tarafında yaptığımız şey

Kobaküs public API referansı işlem sorgularında varsayılan olarak 1000 kayıt döndüğünü ve sorguların küçük tarih aralıklarıyla yapılmasını öneriyor.

TurkishBankMCP uzun tarih aralıklarını kendi içinde 7 günlük parçalara böler. Sonuçları tek liste haline getirir. Aynı sorguları gereksiz yere tekrar atmamak için disk cache kullanır.

Bir istek 1000 kayda dayanırsa sonuçta uyarı verir. Böylece eksik hareket varmış gibi sessizce davranmaz.

Kobaküs public dokümanı transaction response alanlarının tam listesini yayınlamıyor. Provider bu yüzden bilinen standart alan adlarını normalize eder. Canlı response güvenli şekilde eşleşmezse yanlış nakit akışı hesaplamak yerine hata verir ve gördüğü alan adlarını söyler. Değerleri veya API şifresini hata mesajına koymaz.

## ÖHVPS limitleri

Doğrudan ÖHVPS providerında sorgu limitlerini korumak için kalıcı cache var.

Hesap listesi ve işlem sorguları gereksiz yere tekrar bankaya gitmez. 429 ve geçici 5xx cevaplarında kontrollü retry yapılır.

Cache dosyası varsayılan olarak:

```text
.data/cache.json
```

Bu dosya banka verisi içerir ve git'e eklenmez.

## Docker

```bash
docker build -t turkish-bank-mcp .

docker run --rm -i \
  --env-file .env \
  -v "$PWD/.data:/app/.data" \
  turkish-bank-mcp
```

## Güvenlik

`.env` git'e girmez.

`.secrets` git'e girmez.

MCP cevaplarında API şifresi token veya credential dönmez.

TurkishBankMCP içinde ödeme transfer veya satın alma tool'u yok.

Aynı makinede Hermes'e sınırsız shell ve filesystem yetkisi verirsen o ayrı konu. Böyle bir ajan teorik olarak `.env` dosyasını kendi shell tool'u üzerinden okuyabilir. MCP'nin read-only olması başka tool'ların yetkisini kısıtlamaz.

## Kaynaklar

- Kobaküs KWAP API: https://kobakus.com/en/api-dokumantasyon/
- Kobaküs geliştirici sayfası: https://kobakus.com/gelistiriciler/
- Garanti BBVA + Kobaküs: https://kobakus.com/bankalar/garanti-bbva/
- ÖHVPS: https://ohvps.github.io/v2.0.0/

## Lisans

MIT
