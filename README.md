# TurkishBankMCP

TurkishBankMCP, Türkiye'deki açık bankacılık verilerini MCP üzerinden yapay zeka ajanlarına açan, yalnızca okuma amaçlı açık kaynak bir sunucudur.

Proje [ÖHVPS (Ödeme Hizmetleri Veri Paylaşım Servisleri)](https://ohvps.github.io/) standardını kullanır. ÖHVPS, TCMB ve BKM iş birliğiyle oluşturulan Türkiye açık bankacılık altyapısının resmi API standardıdır. Bu proje aktif sürüm olan **ÖHVPS 2.0.0**'ı hedefler.

TurkishBankMCP'nin amacı bankacılık işlemi yapmak değil, finansal veriyi güvenli ve standart bir biçimde okunabilir hale getirmektir. Hermes Agent, OpenClaw veya başka bir MCP istemcisine bağlayarak hesap bakiyesi, para giriş-çıkışları ve kart hareketleri üzerinde günlük/aylık analiz yaptırabilirsiniz.

## Ne yapar?

- Hesapları listeler.
- Güncel bakiyeleri okur.
- Gelen ve giden hesap hareketlerini getirir.
- Günlük veya seçilen tarih aralığı için nakit akışını hesaplar.
- Kartları ve kart hareketlerini okur.
- Kart harcaması/iadelerini özetler.
- ÖHVPS sorgu limitlerini gereksiz yere tüketmemek için disk üzerinde süreli önbellek tutabilir.
- 429 ve geçici 5xx hatalarında kontrollü retry uygular.

## Ne yapmaz?

**Bu MCP para gönderemez, ödeme başlatamaz, alışveriş yapamaz ve kart yönetemez.**

ÖHVPS standardının kendisinde ödeme başlatma servisleri de vardır; TurkishBankMCP bunları bilerek uygulamaz ve MCP tool olarak dışarı açmaz. Kod tabanında yalnızca hesap/kart bilgisi okumaya yönelik endpoint'ler bulunur.

Dolayısıyla ajan tarafında `send_money`, `transfer`, `pay`, `create_payment` gibi bir tool yoktur.

## Hangi bankalarla çalışır?

TurkishBankMCP banka özelinde yazılmış bir entegrasyon değildir. ÖHVPS 2.0.0 kapsamında **Hesap Hizmeti Sağlayıcısı (HHS)** olarak çalışan bankalar ve diğer uyumlu sağlayıcılar aynı standart üzerinden bağlanabilir.

Bu, "Türkiye'deki her banka otomatik olarak çalışır" anlamına gelmez. Bankanın/sağlayıcının ÖHVPS üretim ortamına katılmış ve ilgili hesap/kart bilgi servislerini sunuyor olması gerekir. TCMB'nin Mart 2026 duyurusuna göre Türkiye açık bankacılık altyapısı 53 katılımcıya ulaşmıştır.

Üretim ortamındaki erişim ayrıca müşteri rızası ve yetkili YÖS/HBHS/aggregator akışı gerektirir. Normal bir bireysel banka müşterisine doğrudan kişisel bir "ÖHVPS API key" verilmesi beklenmez.

## Yapay zeka ajanıyla kullanım

MCP'yi Hermes Agent, OpenClaw veya stdio MCP destekleyen başka bir istemciye bağlayabilirsiniz.

Örneğin ajanınıza günlük çalışan bir görev verip şunları yaptırabilirsiniz:

```text
Bugünkü hesap hareketlerimi incele.
Toplam gelen ve giden parayı çıkar.
Dünkü ve son 7 günlük ortalamayla karşılaştır.
Tekrarlayan veya alışılmadık harcamaları belirt.
Bütçem açısından dikkat etmem gereken noktaları kısa şekilde yaz.
Hiçbir finansal işlem yapma; yalnızca veriyi analiz et.
```

Bu yapı özellikle kişisel finans takibi için uygundur: ajan veriyi okur, kategorize eder ve yorumlar; banka hesabında işlem gerçekleştiremez.

## MCP araçları

| Tool | Açıklama |
| --- | --- |
| `bank_provider_status` | Bağlantı ve güvenli yapılandırma durumunu gösterir. Secret değerleri dönmez. |
| `bank_list_accounts` | Rıza kapsamındaki hesapları listeler. |
| `bank_get_balances` | Hesap bakiyelerini getirir. |
| `bank_list_transactions` | Bir hesabın hareketlerini getirir. |
| `bank_cashflow_summary` | Seçilen aralıkta gelen, giden ve net nakit akışını hesaplar. |
| `bank_daily_cashflow` | Türkiye saat dilimini varsayarak tek günün nakit akışını özetler. |
| `bank_monthly_cashflow` | Eski istemciler için geriye uyumlu nakit akışı tool'u. |
| `bank_list_cards` | Rıza kapsamındaki kartları listeler. |
| `bank_list_card_transactions` | Kart hareketlerini getirir. |
| `bank_card_spending_summary` | Kart harcaması, iade ve net harcamayı özetler. |

Tüm tool'lar MCP metadata'sında `readOnlyHint: true` olarak işaretlenir.

## Kurulum

Node.js 22 veya üstü önerilir.

```bash
git clone git@github.com:OnurByte/TurkishBankMCP.git
cd TurkishBankMCP

npm install
cp .env.example .env

npm run check
npm run inspect
```

Varsayılan provider `mock` olduğu için banka erişim bilgisi olmadan MCP'yi çalıştırabilirsiniz.

```bash
npm start
```

## Hermes Agent

Projeyi build ettikten sonra `~/.hermes/config.yaml` içine ekleyebilirsiniz:

```yaml
mcp_servers:
  turkish_bank:
    command: "node"
    args:
      - "/absolute/path/to/TurkishBankMCP/dist/index.js"
    tools:
      include:
        - bank_provider_status
        - bank_list_accounts
        - bank_get_balances
        - bank_list_transactions
        - bank_cashflow_summary
        - bank_daily_cashflow
        - bank_list_cards
        - bank_list_card_transactions
        - bank_card_spending_summary
```

Secret'ları MCP argümanı olarak vermek gerekmez. TurkishBankMCP kendi `.env` dosyasını okuyabilir veya Hermes'in `~/.hermes/.env` dosyasındaki değişkenler `config.yaml` üzerinden aktarılabilir.

## Üretim yapılandırması

ÖHVPS uyumlu gerçek bir provider/aggregator erişiminiz varsa:

```dotenv
BANK_PROVIDER=ohvps
OHVPS_SPEC_VERSION=2.0.0

OHVPS_BASE_URL=https://provider.example/ohvps/hbh/s2.0
OHVPS_TPP_CODE=0000
OHVPS_ASPSP_CODE=0000

OHVPS_GATEWAY_TOKEN=
OHVPS_ACCESS_TOKEN=

# Token'ları env yerine dosyadan okutmak isterseniz:
OHVPS_GATEWAY_TOKEN_FILE=
OHVPS_ACCESS_TOKEN_FILE=
OHVPS_PSU_FRAUD_CHECK_FILE=

OHVPS_GROUP_ID=
OHVPS_PSU_FRAUD_CHECK=

HTTP_TIMEOUT_MS=12000
HTTP_MAX_RETRIES=2
HTTP_RETRY_BASE_MS=500
HTTP_MAX_RETRY_WAIT_MS=5000

# "off" verilirse disk cache kapatılır.
CACHE_FILE=.data/cache.json
```

Secret dosyaları göreli verilirse proje kök dizinine göre çözülür. Token dosyası tanımlanmışsa her istek öncesinde yeniden okunur; bu sayede token rotasyonu için MCP sürecini yeniden başlatmak gerekmez.

### API limitleri

ÖHVPS otomatik sorgular için minimum desteklenmesi gereken limitler tanımlar. Bireysel hesaplarda örneğin hesap listesi günde 4, bakiye günde 24, hesap hareketleri günde 4 ve kart hareketleri günde 32 sorgu seviyesindedir.

TurkishBankMCP bu yüzden:

- hesap listesini 6 saat,
- bakiyeyi 1 saat,
- aynı hesap hareketi sorgusunu 6 saat,
- kart listesini 6 saat,
- aynı kart hareketi sorgusunu 45 dakika

önbellekte tutar.

Cache dosyası process restart sonrasında da korunur ve `0600` izinleriyle yazılmaya çalışılır. Cache banka verisi içerdiği için `.gitignore` kapsamındadır ve paylaşılmamalıdır.

429 yanıtlarında `X-RateLimit-Reset` / `Retry-After` dikkate alınır. Uzun bir bekleme gerekiyorsa MCP çağrısı saatlerce açık tutulmaz; ajan tekrar denemek üzere hata alır.

## Docker

```bash
docker build -t turkish-bank-mcp .
docker run --rm -i \
  --env-file .env \
  -v "$PWD/.data:/app/.data" \
  turkish-bank-mcp
```

MCP stdio kullandığı için container `-i` ile çalıştırılmalıdır.

## Güvenlik

- `.env`, token dosyaları ve `.data` Git'e eklenmez.
- MCP tool çıktılarında credential/token bulunmaz.
- Ödeme veya transfer tool'u yoktur.
- HTTP hata mesajları header/token içeriğini loglamaz.
- Disk cache finansal veri içerdiği için hassas kabul edilmelidir.
- Ajanınıza ayrıca sınırsız shell/filesystem erişimi verdiyseniz bu ayrı bir güvenlik sınırıdır; MCP'nin read-only olması o yetkileri kısıtlamaz.

Daha ayrıntılı notlar için [SECURITY.md](SECURITY.md) dosyasına bakın.

## Production sınırı

Bu repo çalışan bir MCP sunucusu ve ÖHVPS hesap/kart bilgi adapter'ıdır; fakat **YÖS/HBHS lisansı, BKM teknik sertifikasyonu veya müşteri rızası sürecinin yerine geçmez**. Gerçek banka verisine ulaşmak için yetkili bir üretim bağlantısı gerekir.

Doğrudan ÖHVPS katılımcısıysanız kurumunuza ait sertifika, kimlik doğrulama, rıza/GKD ve erişim belirteci yaşam döngüsünü kendi altyapınız veya yetkili gateway'iniz sağlamalıdır. TurkishBankMCP bu katmandan aldığı read-only erişim bilgilerini MCP'ye dönüştürür.

## Kaynaklar

- [ÖHVPS API İlke ve Kuralları](https://ohvps.github.io/)
- [TCMB - Açık Bankacılık Hizmetlerinin Yeni Özellikleri, 17 Mart 2026](https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb%2Btr/main%2Bmenu/duyurular/basin/2026/duy2026-13)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Hermes Agent MCP dokümantasyonu](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md)

## Lisans

MIT
